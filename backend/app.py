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