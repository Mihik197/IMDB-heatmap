# services.py
import requests
import time
import json
import re
import os
from datetime import datetime
import threading
from bs4 import BeautifulSoup

from utils import parse_float, safe_json

# --- Throttle + Caches ---
_last_omdb_call = 0.0
_omdb_lock = threading.Lock()
OMDB_MIN_INTERVAL = 0.25  # 250ms
IMDB_MIN_INTERVAL = 0.5   # a bit slower for IMDb HTML pages

# In-memory caches (non-persistent)
_imdb_season_cache = {}  # key: (imdb_id, season) -> (timestamp, items)
IMDB_SEASON_TTL = 300    # seconds
_search_cache = {}       # key: query_lower -> (timestamp, data)
SEARCH_TTL = 60

def throttled_omdb_get(url, timeout=10):
    global _last_omdb_call
    with _omdb_lock:
        now = time.time()
        delta = now - _last_omdb_call
        if delta < OMDB_MIN_INTERVAL:
            time.sleep(OMDB_MIN_INTERVAL - delta)
        try:
            resp = requests.get(url, timeout=timeout)
        finally:
            _last_omdb_call = time.time()
    return resp

def throttled_imdb_get(url, timeout=10):
    """Separate throttle for raw IMDb HTML fetches."""
    global _last_omdb_call
    with _omdb_lock:
        now = time.time()
        delta = now - _last_omdb_call
        if delta < IMDB_MIN_INTERVAL:
            time.sleep(IMDB_MIN_INTERVAL - delta)
        try:
            resp = requests.get(url, timeout=timeout, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            })
        finally:
            _last_omdb_call = time.time()
    return resp

def parse_imdb_season(imdb_id, season):
    """Parse IMDb season page to extract episodes with short-lived caching.
    Returns list of dicts: {season, episode, title, rating, votes, air_date}
    Skips specials / non-numeric episodes. Adds extra fallbacks & logging when zero items found.
    """
    key = (imdb_id, season)
    now_ts = time.time()
    cached = _imdb_season_cache.get(key)
    if cached and (now_ts - cached[0]) < IMDB_SEASON_TTL and cached[1]:  # don't reuse cached empty
        return cached[1]
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
    # 1) Primary: attempt to parse embedded __NEXT_DATA__ JSON for reliability (enhanced)
    def _emit_entry(entry):
        try:
            # Some lists wrap real episode payload under 'content'
            if isinstance(entry, dict) and 'content' in entry and isinstance(entry['content'], dict):
                entry = entry['content']
            ep_season = entry.get('seasonNumber') or entry.get('season')
            if ep_season is None or int(ep_season) != int(season):
                return False
            ep_num_raw = entry.get('episodeNumber') or entry.get('episode')
            if ep_num_raw is None:
                return False
            ep_num = int(ep_num_raw)
            tt = entry.get('titleText')
            title = tt.get('text') if isinstance(tt, dict) else None
            if not title:
                # Additional fallbacks
                title = entry.get('title') or entry.get('parentTitle') or entry.get('originalTitleText') or 'Unknown'
            rating_info = entry.get('ratingsSummary') or {}
            rating = parse_float(rating_info.get('aggregateRating')) if rating_info else None
            votes_val = rating_info.get('voteCount') if isinstance(rating_info.get('voteCount'), (int, float)) else None
            votes = int(votes_val) if isinstance(votes_val, (int, float)) else None
            air_date = None
            release_date = entry.get('releaseDate') or entry.get('airDate')
            if isinstance(release_date, dict):
                y = release_date.get('year'); m = release_date.get('month'); d = release_date.get('day')
                if all(isinstance(v, int) for v in [y, m, d]):
                    try:
                        air_date = datetime(y, m, d)
                    except Exception:
                        air_date = None
            items.append({
                'season': season,
                'episode': ep_num,
                'title': title,
                'rating': rating,
                'votes': votes,
                'air_date': air_date,
                'imdb_episode_id': entry.get('id') or entry.get('tconst')
            })
            return True
        except Exception as ie:
            print(f"[parse_imdb_season] skip entry error imdb_id={imdb_id} season={season} err={ie}")
            return False
    try:
        next_data_script = soup.find('script', id='__NEXT_DATA__')
        if next_data_script and next_data_script.string:
            data = json.loads(next_data_script.string.strip())
            path_variants = [
                ['props','pageProps','contentData','episodes','items'],
                ['props','pageProps','contentData','section','items'],
                ['props','pageProps','contentData','items'],
            ]
            extracted = None
            for path in path_variants:
                cur = data
                for p in path:
                    if isinstance(cur, dict) and p in cur:
                        cur = cur[p]
                    else:
                        cur = None
                        break
                if isinstance(cur, list):
                    extracted = cur
                    break
            if extracted is None:
                # Recursive search for candidate episode lists
                def find_lists(obj, depth=0):
                    if depth > 8:
                        return []
                    found = []
                    if isinstance(obj, list):
                        if obj and all(isinstance(x, dict) for x in obj):
                            key_hits = sum(1 for x in obj if any(k in x for k in ('episodeNumber','episode','titleText')))
                            if key_hits >= max(1, len(obj)//4):
                                found.append(obj)
                        for v in obj:
                            found.extend(find_lists(v, depth+1))
                    elif isinstance(obj, dict):
                        for v in obj.values():
                            found.extend(find_lists(v, depth+1))
                    return found
                cands = find_lists(data)
                best = None; best_match = 0
                for cand in cands:
                    matches = 0
                    for e in cand:
                        try:
                            s_val = e.get('seasonNumber') or e.get('season')
                            if s_val is not None and int(s_val)==int(season):
                                matches += 1
                        except Exception:
                            continue
                    if matches > best_match:
                        best_match = matches
                        best = cand
                extracted = best
                if os.getenv('IMDB_PARSE_DEBUG')=='1':
                    print(f"[parse_imdb_season] heur_lists={len(cands)} best_match={best_match}")
            if isinstance(extracted, list):
                for e in extracted:
                    _emit_entry(e)
                if items:
                    rated = sum(1 for x in items if x.get('rating') is not None)
                    with_votes = sum(1 for x in items if x.get('votes') is not None)
                    unknown_titles = sum(1 for x in items if x.get('title') == 'Unknown')
                    if os.getenv('IMDB_PARSE_DEBUG')=='1':
                        print(f"[parse_imdb_season] JSON path raw imdb_id={imdb_id} season={season} episodes={len(items)} rated={rated} votes={with_votes} unknown_titles={unknown_titles}")
                    # Accept JSON path only if it produced at least one rating or vote or a majority of titles resolved
                    if rated > 0 or with_votes > 0 or unknown_titles < len(items):
                        if os.getenv('IMDB_PARSE_DEBUG')=='1':
                            print(f"[parse_imdb_season] JSON path accepted imdb_id={imdb_id} season={season}")
                        _imdb_season_cache[key] = (now_ts, items)
                        return items
                    else:
                        # Discard and fall through to DOM parse
                        if os.getenv('IMDB_PARSE_DEBUG')=='1':
                            print(f"[parse_imdb_season] JSON path discarded (no rating/votes) imdb_id={imdb_id} season={season}")
                        items.clear()
    except Exception as e:
        print(f"[parse_imdb_season] next_data parse error imdb_id={imdb_id} season={season} err={e}")
    # Relaxed pattern (not anchored) because IMDb title line includes extra text like "S1.E1 ∙ Episode #1.1"
    label_re = re.compile(rf'S{season}\.E(\d+)')
    # Broaden block selection: include modern article wrapper class used on new layout.
    blocks = soup.select('[data-testid="episodes-list"] [data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('[data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('li[data-testid^="episodes-list-item"], div[data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('article.episode-item-wrapper')
    if not blocks and os.getenv('IMDB_PARSE_DEBUG')=='1':
        print(f"[parse_imdb_season] DOM primary selector found 0 blocks imdb_id={imdb_id} season={season}")
    for block in blocks:
        if block is None or not hasattr(block, 'find'):
            continue
        title_tag = block.find('a', href=re.compile(r'/title/tt'))
        title = title_tag.text.strip() if title_tag and title_tag.text else 'Unknown'
        ep_imdb_id = None
        if title_tag and title_tag.get('href'):
            m_id = re.search(r'/title/(tt\d+)/', title_tag.get('href'))
            if m_id:
                ep_imdb_id = m_id.group(1)
        code_tag = block.find(string=label_re)
        if not code_tag:
            continue
        m = label_re.search(code_tag.strip())
        if not m:
            continue
        try:
            ep_num = int(m.group(1))
        except Exception:
            continue
        rating = None
        votes = None
        rating_container = block.find(attrs={'data-testid': 'ratingGroup--container'}) or block.find(class_=re.compile('ipl-rating-star'))
        if rating_container:
            r_span = rating_container.find('span', class_=re.compile('ipc-rating-star--rating')) or rating_container.find('span', class_=re.compile('ipl-rating-star__rating'))
            if r_span and r_span.text:
                rating = parse_float(r_span.text.strip())
            v_span = rating_container.find('span', class_=re.compile('voteCount')) or rating_container.find('span', class_=re.compile('ipl-rating-star__total-votes'))
            if v_span and v_span.text:
                vt = v_span.text.strip().strip('()').replace(',', '')
                if vt.endswith('K') and vt[:-1].replace('.', '', 1).isdigit():
                    votes = int(float(vt[:-1]) * 1000)
                elif vt.isdigit():
                    votes = int(vt)
        air_date = None
        date_tag = block.find('span', string=re.compile(r'\b\w{3},? \w{3} \d{1,2}, \d{4}\b')) or block.find('div', class_=re.compile('airdate'))
        if date_tag and date_tag.text:
            txt = date_tag.text.strip().replace(',', '')
            txt_norm = txt.replace('.', '')
            for fmt in ['%a %b %d %Y', '%d %b %Y', '%b %d %Y']:
                try:
                    air_date = datetime.strptime(txt_norm, fmt)
                    break
                except Exception:
                    continue
        items.append({
            'season': season,
            'episode': ep_num,
            'title': title,
            'rating': rating,
            'votes': votes,
            'air_date': air_date,
            'imdb_episode_id': ep_imdb_id,
        })
    # Heuristic fallback: search for raw code labels (S{season}.E#) if no structured blocks parsed.
    if not items:
        labels = soup.find_all(string=label_re)
        seen_eps = set()
        for lbl in labels:
            if not lbl or not lbl.strip():
                continue
            m = label_re.search(lbl.strip())
            if not m:
                continue
            try:
                ep_num = int(m.group(1))
            except Exception:
                continue
            if ep_num in seen_eps:
                continue
            # Ascend a few levels to find a nearby anchor with a title and rating container.
            container = lbl.parent
            hops = 0
            while container and hops < 5 and not (getattr(container, 'get', None) and container.get('data-testid', '').startswith('episodes-list-item')):
                container = container.parent
                hops += 1
            block = container if container else lbl.parent
            title_tag = None
            for a in block.find_all('a', href=re.compile(r'/title/tt')):
                if a.text and a.text.strip():
                    title_tag = a
                    break
            title = title_tag.text.strip() if title_tag and title_tag.text else 'Unknown'
            ep_imdb_id = None
            if title_tag and title_tag.get('href'):
                m_id = re.search(r'/title/(tt\d+)/', title_tag.get('href'))
                if m_id:
                    ep_imdb_id = m_id.group(1)
            rating = None
            votes = None
            rating_container = block.find(attrs={'data-testid': 'ratingGroup--container'}) or block.find(class_=re.compile('(ipl-rating-star|ratingGroup--imdb-rating)'))
            if rating_container:
                r_span = rating_container.find('span', class_=re.compile('ipc-rating-star--rating')) or rating_container.find('span', class_=re.compile('ipl-rating-star__rating'))
                if r_span and r_span.text:
                    rating = parse_float(r_span.text.strip())
                v_span = rating_container.find('span', class_=re.compile('(voteCount|total-votes)')) or rating_container.find('span', class_=re.compile('ipl-rating-star__total-votes'))
                if v_span and v_span.text:
                    vt = v_span.text.strip().strip('()').replace(',', '')
                    if vt.endswith('K') and vt[:-1].replace('.', '', 1).isdigit():
                        votes = int(float(vt[:-1]) * 1000)
                    elif vt.isdigit():
                        votes = int(vt)
            items.append({
                'season': season,
                'episode': ep_num,
                'title': title,
                'rating': rating,
                'votes': votes,
                'air_date': None,
                'imdb_episode_id': ep_imdb_id,
            })
            seen_eps.add(ep_num)
        if items and os.getenv('IMDB_PARSE_DEBUG')=='1':
            print(f"[parse_imdb_season] heuristic label fallback success imdb_id={imdb_id} season={season} episodes={len(items)}")
    if not items:
        print(f"[parse_imdb_season] zero items imdb_id={imdb_id} season={season} length_html={len(html)}")
    else:
        if os.getenv('IMDB_PARSE_DEBUG')=='1':
            rated = sum(1 for x in items if x.get('rating') is not None)
            with_votes = sum(1 for x in items if x.get('votes') is not None)
            print(f"[parse_imdb_season] DOM path success imdb_id={imdb_id} season={season} episodes={len(items)} rated={rated} votes={with_votes}")
        _imdb_season_cache[key] = (now_ts, items)
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
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
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