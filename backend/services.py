# services.py
import requests
import time
import json
import re
import os
from bs4 import BeautifulSoup

from utils import safe_json
from imdb_helpers import (
    IMDB_HEADERS,
    throttled_get,
    ttl_cache_get,
    ttl_cache_set,
    parse_imdb_season_json,
    parse_imdb_season_dom,
    parse_imdb_season_heuristic,
)

# --- Throttle + Caches ---
OMDB_MIN_INTERVAL = 0.25  # 250ms
IMDB_MIN_INTERVAL = 0.5   # a bit slower for IMDb HTML pages

# In-memory caches (non-persistent)
_imdb_season_cache = {}  # key: (imdb_id, season) -> (timestamp, items)
IMDB_SEASON_TTL = 300    # seconds
_search_cache = {}       # key: query_lower -> (timestamp, data)
SEARCH_TTL = 60

# Trending shows cache
_trending_cache = {'data': None, 'timestamp': 0}
TRENDING_TTL = 86400  # 24 hours


def get_trending_shows():
    """Scrape IMDB's most popular TV shows chart. Cached for 24 hours."""
    now = time.time()
    if _trending_cache['data'] and (now - _trending_cache['timestamp']) < TRENDING_TTL:
        return _trending_cache['data']
    
    url = 'https://www.imdb.com/chart/tvmeter/'
    try:
        resp = requests.get(url, timeout=15, headers=IMDB_HEADERS)
    except requests.RequestException as e:
        print(f"[get_trending_shows] network error: {e}")
        return []
    
    if resp.status_code != 200:
        print(f"[get_trending_shows] status {resp.status_code}")
        return []
    
    soup = BeautifulSoup(resp.text, 'html.parser')
    shows = []
    
    # Try parsing __NEXT_DATA__ JSON first (most reliable)
    try:
        next_data_script = soup.find('script', id='__NEXT_DATA__')
        if next_data_script and next_data_script.string:
            data = json.loads(next_data_script.string.strip())
            # Navigate to chart entries
            chart_titles = None
            # Common paths in IMDB's Next.js structure
            paths_to_try = [
                ['props', 'pageProps', 'pageData', 'chartTitles', 'edges'],
                ['props', 'pageProps', 'chartTitles', 'edges'],
            ]
            for path in paths_to_try:
                cur = data
                for p in path:
                    if isinstance(cur, dict) and p in cur:
                        cur = cur[p]
                    else:
                        cur = None
                        break
                if isinstance(cur, list) and len(cur) > 0:
                    chart_titles = cur
                    break
            
            if chart_titles:
                for edge in chart_titles:
                    node = edge.get('node', edge)
                    if not node:
                        continue
                    imdb_id = node.get('id') or node.get('tconst')
                    title_text = node.get('titleText', {})
                    title = title_text.get('text') if isinstance(title_text, dict) else None
                    if not title:
                        title = node.get('originalTitleText', {}).get('text')
                    
                    # Get year
                    release_year = node.get('releaseYear', {})
                    year = str(release_year.get('year', '')) if isinstance(release_year, dict) else ''
                    
                    # Get rating
                    ratings = node.get('ratingsSummary', {})
                    rating = ratings.get('aggregateRating') if isinstance(ratings, dict) else None
                    
                    # Get poster
                    primary_image = node.get('primaryImage', {})
                    poster = primary_image.get('url') if isinstance(primary_image, dict) else None
                    
                    if imdb_id and title:
                        shows.append({
                            'imdbID': imdb_id,
                            'title': title,
                            'year': year,
                            'imdbRating': rating,
                            'poster': poster
                        })
    except Exception as e:
        print(f"[get_trending_shows] JSON parse error: {e}")
    
    # Fallback: DOM parsing
    if not shows:
        # Try multiple selectors for chart items
        chart_items = soup.select('li.ipc-metadata-list-summary-item') or soup.select('.chart-container li')
        for item in chart_items:
            try:
                # Find title link
                link = item.find('a', href=re.compile(r'/title/tt\d+'))
                if not link:
                    continue
                href = link.get('href', '')
                m = re.search(r'/title/(tt\d+)', href)
                if not m:
                    continue
                imdb_id = m.group(1)
                title = link.get_text(strip=True)
                
                # Find year
                year_span = item.find('span', class_=re.compile(r'year|date'))
                year = year_span.get_text(strip=True) if year_span else ''
                
                # Find rating
                rating_span = item.find('span', class_=re.compile(r'rating'))
                rating = None
                if rating_span:
                    try:
                        rating = float(rating_span.get_text(strip=True))
                    except:
                        pass
                
                # Find poster
                img = item.find('img')
                poster = img.get('src') if img else None
                
                if imdb_id and title:
                    shows.append({
                        'imdbID': imdb_id,
                        'title': title,
                        'year': year,
                        'imdbRating': rating,
                        'poster': poster
                    })
            except Exception:
                continue
    
    if shows:
        _trending_cache['data'] = shows
        _trending_cache['timestamp'] = now
        print(f"[get_trending_shows] cached {len(shows)} shows")
    else:
        print("[get_trending_shows] no shows found")
    
    return shows

def throttled_omdb_get(url, timeout=10):
    return throttled_get(url, OMDB_MIN_INTERVAL, timeout=timeout)

def throttled_imdb_get(url, timeout=10):
    """Separate throttle for raw IMDb HTML fetches."""
    return throttled_get(url, IMDB_MIN_INTERVAL, timeout=timeout, headers=IMDB_HEADERS)

def parse_imdb_season(imdb_id, season):
    """Parse IMDb season page to extract episodes with short-lived caching.
    Returns list of dicts: {season, episode, title, rating, votes, air_date}
    Skips specials / non-numeric episodes. Adds extra fallbacks & logging when zero items found.
    """
    key = (imdb_id, season)
    now_ts = time.time()
    cached = ttl_cache_get(_imdb_season_cache, key, IMDB_SEASON_TTL, require_value=True)
    if cached:
        return cached
    url = f"https://www.imdb.com/title/{imdb_id}/episodes/?season={season}"
    try:
        resp = throttled_imdb_get(url, timeout=12)
    except requests.RequestException:
        print(f"[parse_imdb_season] network error imdb_id={imdb_id} season={season}")
        return []
    if resp.status_code != 200:
        print(f"[parse_imdb_season] status {resp.status_code} imdb_id={imdb_id} season={season}")
        return []
    html = resp.text
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    if parse_imdb_season_json(soup, imdb_id, season, items):
        ttl_cache_set(_imdb_season_cache, key, items)
        return items
    parse_imdb_season_dom(soup, season, items)
    if not items:
        parse_imdb_season_heuristic(soup, season, items)
    if not items:
        print(f"[parse_imdb_season] zero items imdb_id={imdb_id} season={season} length_html={len(html)}")
    else:
        if os.getenv('IMDB_PARSE_DEBUG')=='1':
            rated = sum(1 for x in items if x.get('rating') is not None)
            with_votes = sum(1 for x in items if x.get('votes') is not None)
            print(f"[parse_imdb_season] DOM path success imdb_id={imdb_id} season={season} episodes={len(items)} rated={rated} votes={with_votes}")
        ttl_cache_set(_imdb_season_cache, key, items)
    return items

def discover_imdb_max_season(imdb_id):
    """Fetch the base episodes page (season=1) to infer max available season from dropdown/options.
    Returns int or None."""
    url = f"https://www.imdb.com/title/{imdb_id}/episodes/"
    try:
        resp = throttled_imdb_get(url, timeout=10)
    except requests.RequestException:
        return None
    if resp.status_code != 200:
        return None
    soup = BeautifulSoup(resp.text, 'html.parser')
    max_season = None
    # imdb often has a season selection dropdown
    for opt in soup.select('select[id*="season"], select[data-testid="episodes-season-select"] option'):
        try:
            val = int(opt.get('value') or opt.text.strip())
        except Exception:
            continue
        if max_season is None or val > max_season:
            max_season = val
    return max_season

def fetch_rating_from_imdb(imdb_id):
    """
    Fetch ratings for episodes which have missing ratings in OMDB API.
    Includes caching and retry logic.
    """
    caching_enabled = os.getenv('ENABLE_SCRAPE_CACHE') == '1'
    if caching_enabled:
        if not hasattr(fetch_rating_from_imdb, '_cache'):
            fetch_rating_from_imdb._cache = {}  # imdb_id -> (timestamp, value or None, found_bool)
        HIT_TTL = 86400  # 24h for successful ratings
        MISS_TTL = 3600  # 1h for misses
        now_ts = time.time()
        entry = fetch_rating_from_imdb._cache.get(imdb_id)
        if entry:
            ts, val, found = entry
            ttl = HIT_TTL if found else MISS_TTL
            if (now_ts - ts) < ttl:
                return val
    else:
        now_ts = time.time()
    url = f'https://www.imdb.com/title/{imdb_id}/'
    headers = IMDB_HEADERS
    backoff = [1, 2, 4]
    result = None
    for attempt, delay in enumerate(backoff, start=1):
        try:
            resp = requests.get(url, headers=headers, timeout=10)
        except requests.RequestException:
            print(f"[scrape] network error attempt {attempt} imdb_id={imdb_id}")
            time.sleep(delay)
            continue
        if resp.status_code != 200:
            print(f"[scrape] status {resp.status_code} attempt {attempt} imdb_id={imdb_id}")
            time.sleep(delay)
            continue
        html = resp.text
        soup = BeautifulSoup(html, 'html.parser')
        ld_scripts = soup.find_all('script', type='application/ld+json')
        for tag in ld_scripts:
            try:
                data = json.loads(tag.string.strip())
            except Exception:
                continue
            candidates = data if isinstance(data, list) else [data]
            for obj in candidates:
                agg = obj.get('aggregateRating') if isinstance(obj, dict) else None
                if agg and isinstance(agg, dict):
                    val = agg.get('ratingValue') or agg.get('rating')
                    if val:
                        print(f"[scrape] JSON-LD rating {val} imdb_id={imdb_id}")
                        result = val
                        break
            if result is not None:
                break
        if result is None:
            m = re.search(r'"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?(\d+\.?\d*)"?', html)
            if m:
                print(f"[scrape] regex rating {m.group(1)} imdb_id={imdb_id}")
                result = m.group(1)
        if result is None:
            meta_rating = soup.find('meta', attrs={'itemprop': 'ratingValue'})
            if meta_rating and meta_rating.get('content'):
                print(f"[scrape] meta rating {meta_rating['content']} imdb_id={imdb_id}")
                result = meta_rating['content']
        if result is None:
            span_candidate = soup.find('span', string=re.compile(r'^[0-9]\.[0-9]$'))
            if span_candidate:
                txt = span_candidate.text.strip()
                if re.match(r'^\d\.\d$', txt):
                    print(f"[scrape] heuristic span rating {txt} imdb_id={imdb_id}")
                    result = txt
        if result is not None:
            break
        time.sleep(delay)
    if caching_enabled:
        fetch_rating_from_imdb._cache[imdb_id] = (now_ts, result, result is not None)
    return result

def fetch_season_from_omdb(api_key, imdb_id, season_number):
    """Helper to fetch season data from OMDb."""
    url = f'http://www.omdbapi.com/?apikey={api_key}&i={imdb_id}&season={season_number}'
    resp = throttled_omdb_get(url)
    if resp.status_code != 200:
        return None
    data = safe_json(resp)
    if data is None or data.get('Response') != 'True':
        return None
    return data