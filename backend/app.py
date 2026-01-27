# app.py
from fastapi import FastAPI, Query, Header
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import os
import time

import services
import worker
from shows import (
    fetch_and_store_show,
    process_missing_refresh,
    process_show_refresh,
    process_metadata_refresh,
    _enrichment_in_progress
)
from shows.show_refresh import _missing_refresh_in_progress
from shows.show_helpers import get_show_data
from utils import sanitize_imdb_id, safe_json

from database import (
    init_db,
    ensure_columns,
    ensure_indices,
    session,
    Show
)

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ensure_columns()
    ensure_indices()
    worker.start_background_maintenance()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_imdb_id(raw_imdb_id, error_message='IMDB ID required'):
    imdb_id = sanitize_imdb_id(raw_imdb_id)
    if not imdb_id:
        return None, JSONResponse({'error': error_message}, status_code=400)
    return imdb_id, None

@app.get('/search')
def search_titles(q: str = Query('', alias='q'), page: str = Query('1', alias='page')):
    """Lightweight search proxy for autocomplete."""
    query = (q or '').strip()
    if not query:
        return []
    
    ql = query.lower()
    cached = services._search_cache.get(ql)
    if cached:
        return cached
        
    api_key = os.getenv('OMDB_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={api_key}&s={query}&type=series&page={page}'
    try:
        resp = services.throttled_omdb_get(url, timeout=8)
    except Exception:
        return []
        
    if resp.status_code != 200:
        return []
        
    data = resp.json()
    if data.get('Response') != 'True':
        return []
        
    results = [{
        'title': item.get('Title'),
        'year': item.get('Year'),
        'imdbID': item.get('imdbID'),
        'type': item.get('Type')
    } for item in data.get('Search', [])[:10]]
    
    services._search_cache.set(ql, results)
    return results

@app.get("/getShowByTitle")
def get_show_by_title(title: str = Query(None, alias='title')):
    if not title:
        return JSONResponse({'error': 'Title not provided'}, status_code=400)

    apiKey = os.getenv('OMDB_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&t={title}'
    response = services.throttled_omdb_get(url)
    
    if response.status_code != 200:
        return JSONResponse({'error': 'Failed to fetch show data'}, status_code=500)

    data = safe_json(response)
    if data is None:
        return JSONResponse({'error': 'Upstream JSON parse failure'}, status_code=502)
        
    if data.get('Response') == 'True':
        return data
    else:
        return JSONResponse({'error': data.get('Error', 'Failed to fetch show data')}, status_code=500)

@app.get("/getShow")
def get_show(
    imdbID: str = Query(None, alias='imdbID'),
    trackView: str = Query('1', alias='trackView'),
    if_none_match: str | None = Header(None, alias='If-None-Match')
):
    imdb_id, error = _require_imdb_id(imdbID, error_message='IMDB ID not provided')
    if error:
        return error
    track_view = trackView == '1'
        
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if show:
        # Increment view count for popularity tracking
        if track_view:
            show.view_count = (show.view_count or 0) + 1
            session.commit()
        return get_show_data(imdb_id, if_none_match, enrichment_set=_enrichment_in_progress, missing_refresh_set=_missing_refresh_in_progress)
    else:
        return fetch_and_store_show(imdb_id, track_view=track_view)

@app.get('/getShowMeta')
def get_show_meta(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='IMDB ID not provided')
    if error:
        return error

    apiKey = os.getenv('OMDB_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    try:
        resp = services.throttled_omdb_get(url, timeout=10)
    except Exception:
        return JSONResponse({'error': 'Upstream failure'}, status_code=502)
    
    if resp.status_code != 200:
        return JSONResponse({'error': 'Upstream status'}, status_code=502)
        
    data = safe_json(resp)
    if not data or data.get('Response') != 'True':
        return JSONResponse({'error': 'Not found'}, status_code=404)
        
    subset = {
        'Title': data.get('Title'), 'Year': data.get('Year'), 'Poster': data.get('Poster'),
        'Plot': data.get('Plot'), 'imdbID': data.get('imdbID'), 'totalSeasons': data.get('totalSeasons')
    }
    return JSONResponse(content=subset, headers={'Cache-Control': 'public, max-age=30'})

@app.post('/refresh/missing')
def refresh_missing(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='IMDB ID required')
    if error:
        return error
    return process_missing_refresh(imdb_id)

@app.post('/refresh/show')
def refresh_show(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='IMDB ID required')
    if error:
        return error
    return process_show_refresh(imdb_id)

@app.post('/refresh/metadata')
def refresh_metadata_only(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='IMDB ID required')
    if error:
        return error
    return process_metadata_refresh(imdb_id)

# --- Discovery Endpoints ---

from featured_shows import FEATURED_SHOW_IDS

# Cache for featured show metadata
_featured_cache = {'data': None, 'timestamp': 0}
FEATURED_CACHE_TTL = 86400  # 24 hours

@app.get('/trending')
def get_trending():
    """Returns trending TV shows scraped from IMDB's chart."""
    shows = services.get_trending_shows()
    return shows

@app.get('/popular')
def get_popular():
    """Returns most viewed shows on this app."""
    shows = session.query(Show).filter(Show.view_count > 0).order_by(Show.view_count.desc()).limit(12).all()
    api_key = os.getenv('OMDB_API_KEY')
    result = []
    
    for s in shows:
        poster = s.poster
        
        # If poster is missing, try to fetch from OMDb and save it
        if not poster:
            try:
                url = f'http://www.omdbapi.com/?apikey={api_key}&i={s.imdb_id}'
                resp = services.throttled_omdb_get(url, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get('Response') == 'True':
                        poster = data.get('Poster')
                        if poster and poster != 'N/A':
                            # Save poster to DB for future requests
                            s.poster = poster
                            session.commit()
            except Exception as e:
                print(f"[popular] fetch error for {s.imdb_id}: {e}")
        
        result.append({
            'imdbID': s.imdb_id,
            'title': s.title,
            'year': s.year,
            'imdbRating': s.imdb_rating,
            'genres': s.genres,
            'poster': poster
        })
    
    return result

@app.get('/featured')
def get_featured():
    """Returns curated list of iconic TV shows - instant response, no blocking API calls."""
    import random
    
    now = time.time()
    
    # Return cached data if still valid
    if _featured_cache['data'] and (now - _featured_cache['timestamp']) < FEATURED_CACHE_TTL:
        return _featured_cache['data']
    
    enriched_shows = []
    
    # Collect all shows instantly - use DB data if available, otherwise basic info
    for show_info in FEATURED_SHOW_IDS:
        imdb_id = show_info['imdbID']
        
        # Check if we have data in the database (instant lookup, no API call)
        db_show = session.query(Show).filter_by(imdb_id=imdb_id).first()
        if db_show and db_show.poster:
            enriched_shows.append({
                'imdbID': imdb_id,
                'title': db_show.title or show_info['title'],
                'year': db_show.year or show_info['year'],
                'poster': db_show.poster,
                'imdbRating': db_show.imdb_rating
            })
        else:
            # Basic info without poster - still usable by frontend
            enriched_shows.append({
                'imdbID': imdb_id,
                'title': show_info['title'],
                'year': show_info['year'],
                'poster': None,
                'imdbRating': None
            })
    
    # Shuffle to add variety, then prioritize shows with posters
    random.shuffle(enriched_shows)
    enriched_shows.sort(key=lambda x: (x['poster'] is None, x['imdbRating'] is None))
    
    # Cache the results
    _featured_cache['data'] = enriched_shows
    _featured_cache['timestamp'] = now
    
    return enriched_shows


# --- Debug Endpoints ---

@app.get('/debug/scrapeRating')
def debug_scrape_rating(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='imdbID required')
    if error:
        return error
    rating = services.fetch_rating_from_imdb(imdb_id)
    return {'imdbID': imdb_id, 'scrapedRating': rating}

@app.get('/debug/clearSeasonCache')
def debug_clear_season_cache(imdbID: str = Query(None, alias='imdbID')):
    imdb_id, error = _require_imdb_id(imdbID, error_message='imdbID required')
    if error:
        return error
    removed = 0
    keys = list(services._imdb_season_cache.keys())
    for k in keys:
        if k[0] == imdb_id:
            services._imdb_season_cache.pop(k, None)
            removed += 1
    return {'cleared': removed}

@app.get('/debug/parseSeason')
def debug_parse_season(
    imdbID: str = Query(None, alias='imdbID'),
    season: str = Query(None, alias='season')
):
    imdb_id, error = _require_imdb_id(imdbID, error_message='imdbID and numeric season required')
    if error or not season or not season.isdigit():
        return JSONResponse({'error': 'imdbID and numeric season required'}, status_code=400)
    key = (imdb_id, int(season))
    services._imdb_season_cache.pop(key, None)
    items = services.parse_imdb_season(imdb_id, int(season))
    return {
        'imdbID': imdb_id, 'season': int(season), 'count': len(items),
        'episodes': items,
        'rated': sum(1 for x in items if x.get('rating') is not None),
        'withVotes': sum(1 for x in items if x.get('votes') is not None)
    }


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app:app', host='0.0.0.0', port=5000, reload=True)