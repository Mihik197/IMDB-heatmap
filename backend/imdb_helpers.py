import os
import re
import time
import json
from datetime import datetime
import threading
import httpx

from utils import parse_float

# --- Throttle ---
_last_call = 0.0
_call_lock = threading.Lock()

IMDB_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
}


def throttled_get(url, min_interval, timeout=10, headers=None):
    global _last_call
    with _call_lock:
        now = time.time()
        delta = now - _last_call
        if delta < min_interval:
            time.sleep(min_interval - delta)
        try:
            resp = httpx.get(url, timeout=timeout, headers=headers)
        finally:
            _last_call = time.time()
    return resp


# --- Cache helpers ---

def ttl_cache_get(cache, key, ttl, require_value=True):
    entry = cache.get(key)
    if not entry:
        return None
    ts, val = entry
    if (time.time() - ts) >= ttl:
        return None
    if require_value and not val:
        return None
    return val


def ttl_cache_set(cache, key, value):
    cache[key] = (time.time(), value)


# --- Parsing helpers ---

def parse_air_date(text):
    if not text:
        return None
    txt = text.strip().replace(',', '')
    txt_norm = txt.replace('.', '')
    for fmt in ['%a %b %d %Y', '%d %b %Y', '%b %d %Y']:
        try:
            return datetime.strptime(txt_norm, fmt)
        except Exception:
            continue
    return None


def extract_imdb_id_from_href(href):
    if not href:
        return None
    m_id = re.search(r'/title/(tt\d+)/', href)
    return m_id.group(1) if m_id else None


def parse_rating_votes(rating_container):
    rating = None
    votes = None
    if not rating_container:
        return rating, votes
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
    return rating, votes


def parse_imdb_season_json(soup, imdb_id, season, items):
    def _emit_entry(entry):
        try:
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
                    if rated > 0 or with_votes > 0 or unknown_titles < len(items):
                        if os.getenv('IMDB_PARSE_DEBUG')=='1':
                            print(f"[parse_imdb_season] JSON path accepted imdb_id={imdb_id} season={season}")
                        return True
                    else:
                        if os.getenv('IMDB_PARSE_DEBUG')=='1':
                            print(f"[parse_imdb_season] JSON path discarded (no rating/votes) imdb_id={imdb_id} season={season}")
                        items.clear()
    except Exception as e:
        print(f"[parse_imdb_season] next_data parse error imdb_id={imdb_id} season={season} err={e}")
    return False


def parse_imdb_season_dom(soup, season, items):
    label_re = re.compile(rf'S{season}\.E(\d+)')
    blocks = soup.select('[data-testid="episodes-list"] [data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('[data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('li[data-testid^="episodes-list-item"], div[data-testid^="episodes-list-item"]')
    if not blocks:
        blocks = soup.select('article.episode-item-wrapper')
    if not blocks and os.getenv('IMDB_PARSE_DEBUG')=='1':
        print(f"[parse_imdb_season] DOM primary selector found 0 blocks season={season}")
    for block in blocks:
        if block is None or not hasattr(block, 'find'):
            continue
        title_tag = block.find('a', href=re.compile(r'/title/tt'))
        title = title_tag.text.strip() if title_tag and title_tag.text else 'Unknown'
        ep_imdb_id = extract_imdb_id_from_href(title_tag.get('href')) if title_tag else None
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
        rating_container = block.find(attrs={'data-testid': 'ratingGroup--container'}) or block.find(class_=re.compile('ipl-rating-star'))
        rating, votes = parse_rating_votes(rating_container)
        date_tag = block.find('span', string=re.compile(r'\b\w{3},? \w{3} \d{1,2}, \d{4}\b')) or block.find('div', class_=re.compile('airdate'))
        air_date = parse_air_date(date_tag.text) if date_tag and date_tag.text else None
        items.append({
            'season': season,
            'episode': ep_num,
            'title': title,
            'rating': rating,
            'votes': votes,
            'air_date': air_date,
            'imdb_episode_id': ep_imdb_id,
        })


def parse_imdb_season_heuristic(soup, season, items):
    label_re = re.compile(rf'S{season}\.E(\d+)')
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
        ep_imdb_id = extract_imdb_id_from_href(title_tag.get('href')) if title_tag else None
        rating_container = block.find(attrs={'data-testid': 'ratingGroup--container'}) or block.find(class_=re.compile('(ipl-rating-star|ratingGroup--imdb-rating)'))
        rating, votes = parse_rating_votes(rating_container)
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
        print(f"[parse_imdb_season] heuristic label fallback success season={season} episodes={len(items)}")
