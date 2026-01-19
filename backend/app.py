# app.py
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from dotenv import load_dotenv
import os
import time

import services
import show_manager
import worker
from utils import sanitize_imdb_id, safe_json

from database import (
    init_db,
    ensure_columns,
    ensure_indices,
    is_episode_stale,
    is_show_metadata_stale,
    session,
    Show,
    Episode
)

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

@app.route('/search')
def search_titles():
    """Lightweight search proxy for autocomplete."""
    query = request.args.get('q', '').strip()
    page = request.args.get('page', '1')
    if not query:
        return jsonify([])
    
    ql = query.lower()
    now = time.time()
    cached = services._search_cache.get(ql)
    if cached and (now - cached[0]) < services.SEARCH_TTL:
        return jsonify(cached[1])
        
    api_key = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={api_key}&s={query}&type=series&page={page}'
    try:
        resp = services.throttled_omdb_get(url, timeout=8)
    except Exception:
        return jsonify([])
        
    if resp.status_code != 200:
        return jsonify([])
        
    data = resp.json()
    if data.get('Response') != 'True':
        return jsonify([])
        
    results = [{
        'title': item.get('Title'),
        'year': item.get('Year'),
        'imdbID': item.get('imdbID'),
        'type': item.get('Type')
    } for item in data.get('Search', [])[:10]]
    
    services._search_cache[ql] = (now, results)
    return jsonify(results)

@app.route("/getShowByTitle")
def get_show_by_title():
    title = request.args.get('title')
    if not title:
        return jsonify({'error': 'Title not provided'}), 400

    apiKey = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&t={title}'
    response = services.throttled_omdb_get(url)
    
    if response.status_code != 200:
        return jsonify({'error': 'Failed to fetch show data'}), 500

    data = safe_json(response)
    if data is None:
        return jsonify({'error': 'Upstream JSON parse failure'}), 502
        
    if data.get('Response') == 'True':
        return jsonify(data)
    else:
        return jsonify({'error': data.get('Error', 'Failed to fetch show data')}), 500

@app.route("/getShow")
def get_show():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'IMDB ID not provided'}), 400
        
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if show:
        # Increment view count for popularity tracking
        show.view_count = (show.view_count or 0) + 1
        session.commit()
        return get_show_data(imdb_id)
    else:
        return show_manager.fetch_and_store_show(imdb_id)

def get_show_data(imdb_id):
    """Helper to fetch show data from DB and format it for the API response."""
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return jsonify({'error': 'Show not found in DB'}), 404
        
    try:
        session.refresh(show)
    except Exception:
        pass # Handle detached instance error if occurs
        
    episodes = session.query(Episode).filter_by(show_id=show.id).all()
    incomplete = any(ep.rating is None for ep in episodes)
    metadata_stale = is_show_metadata_stale(show)
    episodes_stale_count = sum(1 for ep in episodes if is_episode_stale(ep))
    absent_count = sum(1 for ep in episodes if getattr(ep, 'absent', False))
    provisional_count = sum(1 for ep in episodes if getattr(ep, 'provisional', False))
    
    etag_val = f"{int(show.last_updated.timestamp()) if show.last_updated else 0}:{len(episodes)}:{show.total_seasons}:{absent_count}"
    if request.headers.get('If-None-Match') == etag_val:
        resp = make_response('', 304)
        resp.headers['ETag'] = etag_val
        return resp
        
    payload = {
        'title': show.title, 'imdbID': show.imdb_id, 'totalSeasons': show.total_seasons,
        'genres': show.genres, 'year': show.year, 'imdbRating': show.imdb_rating,
        'imdbVotes': show.imdb_votes,
        'lastFullRefresh': show.last_full_refresh.isoformat() if show.last_full_refresh else None,
        'incomplete': incomplete, 'metadataStale': metadata_stale,
        'episodesStaleCount': episodes_stale_count,
        'partialData': (provisional_count > 0 or absent_count > 0 or (imdb_id in show_manager._enrichment_in_progress)),
        'episodes': [{
            'season': ep.season, 'episode': ep.episode, 'title': ep.title, 'rating': ep.rating,
            'imdb_id': ep.imdb_id, 'votes': ep.votes,
            'lastChecked': ep.last_checked.isoformat() if ep.last_checked else None,
            'missing': ep.missing, 'absent': getattr(ep, 'absent', None),
            'provisional': getattr(ep, 'provisional', None),
            'airDate': ep.air_date.isoformat() if getattr(ep, 'air_date', None) else None,
        } for ep in episodes],
        'absentEpisodesCount': absent_count,
        'provisionalEpisodesCount': provisional_count
    }
    
    resp = jsonify(payload)
    resp.headers['ETag'] = etag_val
    resp.headers['Cache-Control'] = 'public, max-age=5'
    return resp

@app.route('/getShowMeta')
def get_show_meta():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'IMDB ID not provided'}), 400

    apiKey = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    try:
        resp = services.throttled_omdb_get(url, timeout=10)
    except Exception:
        return jsonify({'error': 'Upstream failure'}), 502
    
    if resp.status_code != 200:
        return jsonify({'error': 'Upstream status'}), 502
        
    data = safe_json(resp)
    if not data or data.get('Response') != 'True':
        return jsonify({'error': 'Not found'}), 404
        
    subset = {
        'Title': data.get('Title'), 'Year': data.get('Year'), 'Poster': data.get('Poster'),
        'Plot': data.get('Plot'), 'imdbID': data.get('imdbID'), 'totalSeasons': data.get('totalSeasons')
    }
    resp = jsonify(subset)
    resp.headers['Cache-Control'] = 'public, max-age=30'
    return resp

@app.route('/refresh/missing', methods=['POST'])
def refresh_missing():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'IMDB ID required'}), 400
    return show_manager.process_missing_refresh(imdb_id)

@app.route('/refresh/show', methods=['POST'])
def refresh_show():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'IMDB ID required'}), 400
    return show_manager.process_show_refresh(imdb_id)

@app.route('/refresh/metadata', methods=['POST'])
def refresh_metadata_only():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'IMDB ID required'}), 400
    return show_manager.process_metadata_refresh(imdb_id)

# --- Discovery Endpoints ---

# Curated list of iconic TV shows with interesting heatmaps (just IDs and titles)
FEATURED_SHOW_IDS = [
    # All-time greats
    {'imdbID': 'tt0903747', 'title': 'Breaking Bad', 'year': '2008–2013'},
    {'imdbID': 'tt0944947', 'title': 'Game of Thrones', 'year': '2011–2019'},
    {'imdbID': 'tt0386676', 'title': 'The Office', 'year': '2005–2013'},
    {'imdbID': 'tt0141842', 'title': 'The Sopranos', 'year': '1999–2007'},
    {'imdbID': 'tt0306414', 'title': 'The Wire', 'year': '2002–2008'},
    {'imdbID': 'tt0773262', 'title': 'Dexter', 'year': '2006–2013'},
    {'imdbID': 'tt4574334', 'title': 'Stranger Things', 'year': '2016–'},
    {'imdbID': 'tt1475582', 'title': 'Sherlock', 'year': '2010–2017'},
    {'imdbID': 'tt2861424', 'title': 'Rick and Morty', 'year': '2013–'},
    {'imdbID': 'tt0460649', 'title': 'How I Met Your Mother', 'year': '2005–2014'},
    {'imdbID': 'tt0411008', 'title': 'Lost', 'year': '2004–2010'},
    {'imdbID': 'tt1520211', 'title': 'The Walking Dead', 'year': '2010–2022'},
    {'imdbID': 'tt0098904', 'title': 'Seinfeld', 'year': '1989–1998'},
    {'imdbID': 'tt0108778', 'title': 'Friends', 'year': '1994–2004'},
    {'imdbID': 'tt1856010', 'title': 'House of Cards', 'year': '2013–2018'},
    {'imdbID': 'tt2356777', 'title': 'True Detective', 'year': '2014–'},
    # Modern classics
    {'imdbID': 'tt5180504', 'title': 'The Witcher', 'year': '2019–'},
    {'imdbID': 'tt5071412', 'title': 'Ozark', 'year': '2017–2022'},
    {'imdbID': 'tt2085059', 'title': 'Black Mirror', 'year': '2011–'},
    {'imdbID': 'tt4786824', 'title': 'The Crown', 'year': '2016–'},
    {'imdbID': 'tt0475784', 'title': 'Westworld', 'year': '2016–2022'},
    {'imdbID': 'tt0804503', 'title': 'Mad Men', 'year': '2007–2015'},
    {'imdbID': 'tt2306299', 'title': 'Vikings', 'year': '2013–2020'},
    {'imdbID': 'tt0898266', 'title': 'The Big Bang Theory', 'year': '2007–2019'},
    {'imdbID': 'tt0460681', 'title': 'Supernatural', 'year': '2005–2020'},
    {'imdbID': 'tt0121955', 'title': 'South Park', 'year': '1997–'},
    {'imdbID': 'tt0182576', 'title': 'Family Guy', 'year': '1999–'},
    {'imdbID': 'tt0096697', 'title': 'The Simpsons', 'year': '1989–'},
    {'imdbID': 'tt1586680', 'title': 'Shameless', 'year': '2011–2021'},
    {'imdbID': 'tt0472954', 'title': 'It\'s Always Sunny in Philadelphia', 'year': '2005–'},
]

# Cache for featured show metadata
_featured_cache = {'data': None, 'timestamp': 0}
FEATURED_CACHE_TTL = 86400  # 24 hours

@app.route('/trending')
def get_trending():
    """Returns trending TV shows scraped from IMDB's chart."""
    shows = services.get_trending_shows()
    return jsonify(shows)

@app.route('/popular')
def get_popular():
    """Returns most viewed shows on this app."""
    shows = session.query(Show).filter(Show.view_count > 0).order_by(Show.view_count.desc()).limit(12).all()
    api_key = os.getenv('VITE_API_KEY')
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
    
    return jsonify(result)

@app.route('/featured')
def get_featured():
    """Returns curated list of iconic TV shows with fresh poster/rating data."""
    now = time.time()
    
    # Return cached data if still valid
    if _featured_cache['data'] and (now - _featured_cache['timestamp']) < FEATURED_CACHE_TTL:
        return jsonify(_featured_cache['data'])
    
    api_key = os.getenv('VITE_API_KEY')
    enriched_shows = []
    
    for show_info in FEATURED_SHOW_IDS:
        imdb_id = show_info['imdbID']
        
        # First check if we have fresh data in the database
        db_show = session.query(Show).filter_by(imdb_id=imdb_id).first()
        if db_show and db_show.poster and db_show.imdb_rating:
            enriched_shows.append({
                'imdbID': imdb_id,
                'title': db_show.title or show_info['title'],
                'year': db_show.year or show_info['year'],
                'poster': db_show.poster,
                'imdbRating': db_show.imdb_rating
            })
            continue
        
        # Otherwise fetch from OMDb
        try:
            url = f'http://www.omdbapi.com/?apikey={api_key}&i={imdb_id}'
            resp = services.throttled_omdb_get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('Response') == 'True':
                    poster = data.get('Poster')
                    rating = data.get('imdbRating')
                    if poster and poster != 'N/A':
                        enriched_shows.append({
                            'imdbID': imdb_id,
                            'title': data.get('Title', show_info['title']),
                            'year': data.get('Year', show_info['year']),
                            'poster': poster,
                            'imdbRating': float(rating) if rating and rating != 'N/A' else None
                        })
                        continue
        except Exception as e:
            print(f"[featured] fetch error for {imdb_id}: {e}")
        
        # Fallback to basic info without poster
        enriched_shows.append({
            'imdbID': imdb_id,
            'title': show_info['title'],
            'year': show_info['year'],
            'poster': None,
            'imdbRating': None
        })
    
    # Cache the results
    _featured_cache['data'] = enriched_shows
    _featured_cache['timestamp'] = now
    
    return jsonify(enriched_shows)


# --- Debug Endpoints ---

@app.route('/debug/scrapeRating')
def debug_scrape_rating():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'imdbID required'}), 400
    rating = services.fetch_rating_from_imdb(imdb_id)
    return jsonify({'imdbID': imdb_id, 'scrapedRating': rating})

@app.route('/debug/clearSeasonCache')
def debug_clear_season_cache():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    if not imdb_id:
        return jsonify({'error': 'imdbID required'}), 400
    removed = 0
    keys = list(services._imdb_season_cache.keys())
    for k in keys:
        if k[0] == imdb_id:
            services._imdb_season_cache.pop(k, None)
            removed += 1
    return jsonify({'cleared': removed})

@app.route('/debug/parseSeason')
def debug_parse_season():
    imdb_id = sanitize_imdb_id(request.args.get('imdbID'))
    season = request.args.get('season')
    if not imdb_id or not season or not season.isdigit():
        return jsonify({'error': 'imdbID and numeric season required'}), 400
    key = (imdb_id, int(season))
    services._imdb_season_cache.pop(key, None)
    items = services.parse_imdb_season(imdb_id, int(season))
    return jsonify({
        'imdbID': imdb_id, 'season': int(season), 'count': len(items),
        'episodes': items,
        'rated': sum(1 for x in items if x.get('rating') is not None),
        'withVotes': sum(1 for x in items if x.get('votes') is not None)
    })


if __name__ == '__main__':
    init_db()
    ensure_columns()
    ensure_indices()
    worker.start_background_maintenance()
    app.run(debug=True)