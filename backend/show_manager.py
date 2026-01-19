# show_manager.py
import threading
import os
import traceback
from datetime import datetime, UTC
from flask import jsonify

# Import your database models and session
from database import (
    session,
    Show,
    Episode,
    SeasonHash,
    engine,
    get_or_create_season_hash,
    compute_season_signature
)
from sqlalchemy.orm import sessionmaker

# Import the new modules
import services
from utils import parse_float, safe_json

# Track background enrichment progress for fast ingest shows (in-memory, non-persistent)
_enrichment_in_progress = set()
_enrichment_lock = threading.Lock()

def fetch_and_store_show(imdb_id):
    """
    Standard path to fetch a show from OMDb, scrape IMDb for missing ratings,
    and store everything in the database.
    """
    # Gate: if FAST_INGEST enabled use new path
    if os.getenv('FAST_INGEST') == '1':
        return fast_fetch_and_store_show(imdb_id)
        
    apiKey = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    response = services.throttled_omdb_get(url)
    if response.status_code != 200:
        return jsonify({'error': 'Failed to fetch show data'}), 500

    data = safe_json(response)
    if data is None:
        print(f"[fetch_show] JSON decode failure imdb_id={imdb_id}")
        return jsonify({'error': 'Upstream JSON parse failure'}), 502
    
    if data.get('Response') == 'True':
        show = Show(
            imdb_id=imdb_id,
            title=data['Title'],
            total_seasons=int(data['totalSeasons']),
            genres=data.get('Genre'),
            year=data.get('Year'),
            imdb_rating=parse_float(data.get('imdbRating')),
            imdb_votes=int(data.get('imdbVotes').replace(',','')) if data.get('imdbVotes') and data.get('imdbVotes').replace(',','').isdigit() else None,
            poster=data.get('Poster'),
            last_full_refresh=datetime.now(UTC).replace(tzinfo=None)
        )
        session.add(show)
        session.commit()

        # fetch data for each season
        for season_num in range(1, show.total_seasons + 1):
            season_data = services.fetch_season_from_omdb(apiKey, imdb_id, season_num)
            if season_data:
                for ep_data in season_data.get('Episodes', []):
                    rating = parse_float(ep_data.get('imdbRating'))
                    if rating is None:
                        scraped = services.fetch_rating_from_imdb(ep_data['imdbID'])
                        rating = parse_float(scraped)
                    votes = None
                    if ep_data.get('imdbVotes') and ep_data.get('imdbVotes').replace(',','').isdigit():
                        votes = int(ep_data.get('imdbVotes').replace(',',''))
                    episode = Episode(
                        show_id=show.id,
                        season=season_num,
                        episode=int(ep_data.get('Episode', 0)),
                        title=ep_data.get('Title', 'No Title'),
                        rating=rating,
                        imdb_id=ep_data.get('imdbID', 'No IMDb ID'),
                        votes=votes,
                        last_checked=datetime.now(UTC).replace(tzinfo=None),
                        missing=(rating is None)
                    )
                    session.add(episode)
            session.commit()
            season_eps = session.query(Episode).filter_by(show_id=show.id, season=season_num).all()
            sig = compute_season_signature(season_eps)
            sh = get_or_create_season_hash(show.id, season_num)
            sh.signature = sig
            sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
            session.commit()
        
        # After all seasons are done, make the final commit and call get_show to return data
        session.commit()
        # This part requires access to the app context, so we'll return a special signal
        # or have the app call a 'get show data' function. For simplicity, we just return a success
        # and the frontend can re-query. Or we can structure this to return the final payload.
        # Let's rebuild the payload here to keep it self-contained.
        from app import get_show_data
        return get_show_data(imdb_id)
        
    return jsonify({'error': 'Failed to fetch show data'}), 500

def fast_fetch_and_store_show(imdb_id):
    """Fast ingest path: quickly stores OMDb data and spawns a background thread for IMDb enrichment."""
    apiKey = os.getenv('VITE_API_KEY')
    series_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    try:
        resp = services.throttled_omdb_get(series_url, timeout=10)
    except Exception:
        return jsonify({'error': 'Upstream failure'}), 502
    
    if resp.status_code != 200:
        return jsonify({'error': 'Upstream status'}), 502
    
    meta = safe_json(resp)
    if not meta or meta.get('Response') != 'True':
        return jsonify({'error': 'Not found'}), 404
        
    try:
        total_seasons = int(meta.get('totalSeasons', 0))
    except Exception:
        total_seasons = 0
        
    show = Show(
        imdb_id=imdb_id,
        title=meta.get('Title'),
        total_seasons=total_seasons,
        genres=meta.get('Genre'),
        year=meta.get('Year'),
        imdb_rating=parse_float(meta.get('imdbRating')),
        imdb_votes=int(meta.get('imdbVotes').replace(',','')) if meta.get('imdbVotes') and meta.get('imdbVotes').replace(',','').isdigit() else None,
        poster=meta.get('Poster'),
        last_full_refresh=datetime.now(UTC).replace(tzinfo=None)
    )
    session.add(show)
    session.commit()
    
    for season_num in range(1, total_seasons + 1):
        omdb_data = services.fetch_season_from_omdb(apiKey, imdb_id, season_num)
        if omdb_data:
            for ep_data in omdb_data.get('Episodes', []):
                try:
                    ep_num = int(ep_data.get('Episode', 0))
                except Exception:
                    continue
                rating = parse_float(ep_data.get('imdbRating'))
                votes = None
                if ep_data.get('imdbVotes') and ep_data.get('imdbVotes').replace(',','').isdigit():
                    votes = int(ep_data.get('imdbVotes').replace(',',''))
                episode = Episode(
                    show_id=show.id,
                    season=season_num,
                    episode=ep_num,
                    title=ep_data.get('Title', 'No Title'),
                    rating=rating,
                    imdb_id=ep_data.get('imdbID', 'No IMDb ID'),
                    votes=votes,
                    last_checked=datetime.now(UTC).replace(tzinfo=None),
                    missing=(rating is None),
                    absent=False,
                    provisional=False,
                    air_date=None
                )
                session.add(episode)
        session.commit()
        season_eps = session.query(Episode).filter_by(show_id=show.id, season=season_num).all()
        sig = compute_season_signature(season_eps)
        sh = get_or_create_season_hash(show.id, season_num)
        sh.signature = sig
        sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
        session.commit()
        
    show.last_updated = datetime.now(UTC).replace(tzinfo=None)
    session.commit()
    
    with _enrichment_lock:
        _enrichment_in_progress.add(imdb_id)
    print(f"[fast_ingest] queued enrichment imdb_id={imdb_id} seasons={total_seasons}")
    threading.Thread(target=_imdb_enrich_show, args=(show.id, imdb_id, total_seasons), daemon=True).start()
    
    from app import get_show_data
    return get_show_data(imdb_id)

def _imdb_enrich_show(show_db_id, imdb_id, total_seasons):
    """Background enrichment: fetch IMDb season pages, override ratings/votes/air_date, add absent placeholders, promote updated episodes."""
    print(f"[enrich] start imdb_id={imdb_id} seasons={total_seasons}")
    ThreadSession = sessionmaker(bind=engine)
    thread_session = ThreadSession()
    try:
        show = thread_session.query(Show).filter_by(id=show_db_id).first()
        if not show:
            print(f"[enrich] show vanished imdb_id={imdb_id}")
            return
        any_updates = False
        for season in range(1, total_seasons + 1):
            items = services.parse_imdb_season(imdb_id, season)
            print(f"[enrich] imdb_id={imdb_id} season={season} fetched {len(items)} items")
            if not items:
                continue
            idx = { it['episode']: it for it in items }
            existing_eps = { e.episode: e for e in thread_session.query(Episode).filter_by(show_id=show.id, season=season).all() }
            season_changed = False
            season_mods = 0
            for ep_num, ep in existing_eps.items():
                meta = idx.get(ep_num)
                if not meta:
                    continue
                changed = False
                if meta.get('rating') is not None and ep.rating != meta.get('rating'):
                    ep.rating = meta.get('rating'); changed = True; ep.missing = (ep.rating is None)
                if meta.get('votes') is not None and ep.votes != meta.get('votes'):
                    ep.votes = meta.get('votes'); changed = True
                if meta.get('air_date') and ep.air_date != meta.get('air_date'):
                    ep.air_date = meta.get('air_date'); changed = True
                if changed:
                    ep.last_checked = datetime.now(UTC).replace(tzinfo=None)
                    season_changed = True
                    season_mods += 1
            existing_nums = set(existing_eps.keys())
            for meta in items:
                if meta['episode'] not in existing_nums:
                    placeholder = Episode(
                        show_id=show.id,
                        season=season,
                        episode=meta['episode'],
                        title=meta['title'],
                        rating=meta['rating'],
                        imdb_id=meta.get('imdb_episode_id') or f"{imdb_id}-S{season}E{meta['episode']}",
                        votes=meta['votes'],
                        last_checked=datetime.now(UTC).replace(tzinfo=None),
                        missing=(meta['rating'] is None),
                        absent=True,
                        provisional=True,
                        air_date=meta['air_date']
                    )
                    thread_session.add(placeholder)
                    season_changed = True
                    season_mods += 1
            if season_changed:
                thread_session.commit()
                season_eps = thread_session.query(Episode).filter_by(show_id=show.id, season=season).all()
                sig = compute_season_signature(season_eps)
                sh = thread_session.query(SeasonHash).filter_by(show_id=show.id, season=season).first()
                if not sh:
                    sh = SeasonHash(show_id=show.id, season=season, signature='', last_computed=datetime.now(UTC).replace(tzinfo=None))
                    thread_session.add(sh)
                sh.signature = sig
                sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
                show.last_updated = datetime.now(UTC).replace(tzinfo=None)
                thread_session.commit()
                any_updates = True
                print(f"[enrich] updated season signature imdb_id={imdb_id} season={season} sig={sig} mods={season_mods}")
            else:
                print(f"[enrich] no season changes imdb_id={imdb_id} season={season}")
        if any_updates:
            show.last_updated = datetime.now(UTC).replace(tzinfo=None)
            thread_session.commit()
            print(f"[enrich] complete imdb_id={imdb_id} updates_applied=1")
        else:
            print(f"[enrich] complete imdb_id={imdb_id} updates_applied=0 (no changes)")
    except Exception as e:
        print(f"[imdb_enrich] error {imdb_id}: {e}\n{traceback.format_exc()}")
    finally:
        with _enrichment_lock:
            if imdb_id in _enrichment_in_progress:
                _enrichment_in_progress.remove(imdb_id)
        thread_session.close()
        print(f"[enrich] release imdb_id={imdb_id}")

def process_missing_refresh(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return jsonify({'error': 'Show not found in DB'}), 404
    missing_eps = session.query(Episode).filter_by(show_id=show.id, rating=None).all()
    updated = 0
    for ep in missing_eps:
        season_data = services.fetch_season_from_omdb(apiKey, imdb_id, ep.season)
        if season_data:
            for ep_data in season_data.get('Episodes', []):
                if ep_data.get('Episode') and int(ep_data['Episode']) == ep.episode:
                    rating = parse_float(ep_data.get('imdbRating'))
                    if rating is None:
                        scraped = services.fetch_rating_from_imdb(ep_data.get('imdbID'))
                        rating = parse_float(scraped)
                    if rating is not None:
                        ep.rating = rating
                        ep.missing = False
                        ep.last_checked = datetime.now(UTC).replace(tzinfo=None)
                        if ep_data.get('imdbVotes') and ep_data.get('imdbVotes').replace(',','').isdigit():
                            ep.votes = int(ep_data.get('imdbVotes').replace(',',''))
                        updated += 1
                    else:
                        ep.missing = True
                        ep.last_checked = datetime.now(UTC).replace(tzinfo=None)
                    break
    if updated:
        session.commit()
    return jsonify({'updated': updated})

def process_show_refresh(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return fetch_and_store_show(imdb_id)

    series_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    series_resp = services.throttled_omdb_get(series_url)
    sdata = safe_json(series_resp) if series_resp.status_code == 200 else None
    
    if sdata and sdata.get('Response') == 'True':
        show.title = sdata.get('Title', show.title)
        try:
            new_total = int(sdata.get('totalSeasons', show.total_seasons))
        except Exception:
            new_total = show.total_seasons
        show.genres = sdata.get('Genre', show.genres)
        show.year = sdata.get('Year', show.year)
        show.imdb_rating = parse_float(sdata.get('imdbRating')) or show.imdb_rating
        if sdata.get('imdbVotes') and sdata.get('imdbVotes').replace(',','').isdigit():
            show.imdb_votes = int(sdata.get('imdbVotes').replace(',',''))
        # Save poster if available
        poster = sdata.get('Poster')
        if poster and poster != 'N/A':
            show.poster = poster
        if new_total > show.total_seasons:
            show.total_seasons = new_total
    
    imdb_max = services.discover_imdb_max_season(imdb_id)
    if imdb_max and imdb_max > show.total_seasons:
        show.total_seasons = imdb_max
        session.commit()
        
    total = show.total_seasons
    updated = 0
    for season in range(1, total + 1):
        season_data = services.fetch_season_from_omdb(apiKey, imdb_id, season)
        if not season_data:
            continue
            
        eps_list = season_data.get('Episodes', []) or []
        quick_count = len(eps_list)
        quick_ratings = [val for ed in eps_list if (val := parse_float(ed.get('imdbRating'))) is not None]
        quick_avg = sum(quick_ratings)/len(quick_ratings) if quick_ratings else 0.0
        quick_sig = f"{quick_count}:{quick_avg:.3f}"
        
        sh_existing = session.query(SeasonHash).filter_by(show_id=show.id, season=season).first()
        has_missing = session.query(Episode).filter_by(show_id=show.id, season=season, missing=True).first() is not None
        
        imdb_eps = []
        if sh_existing and sh_existing.signature == quick_sig and not has_missing:
            imdb_eps = services.parse_imdb_season(imdb_id, season)
            if imdb_eps:
                existing_keys = {(e.season, e.episode) for e in session.query(Episode).filter_by(show_id=show.id, season=season).all()}
                imdb_keys = {(season, e['episode']) for e in imdb_eps}
                new_missing = imdb_keys - existing_keys
                for _, ep_num in sorted(new_missing):
                    meta = next((m for m in imdb_eps if m['episode']==ep_num), None)
                    if not meta: continue
                    placeholder = Episode(
                        show_id=show.id, season=season, episode=ep_num, title=meta['title'],
                        rating=meta['rating'], imdb_id=meta.get('imdb_episode_id') or f"{imdb_id}-S{season}E{ep_num}",
                        votes=meta['votes'], last_checked=datetime.now(UTC).replace(tzinfo=None),
                        missing=(meta['rating'] is None), absent=True, provisional=True, air_date=meta['air_date']
                    )
                    session.add(placeholder)
                if new_missing:
                    session.commit()
                    season_eps = session.query(Episode).filter_by(show_id=show.id, season=season).all()
                    sig = compute_season_signature(season_eps)
                    sh = get_or_create_season_hash(show.id, season)
                    sh.signature = sig
                    sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
                    updated += 1
            continue

        existing_eps = { (e.season, e.episode): e for e in session.query(Episode).filter_by(show_id=show.id, season=season).all() }
        season_changed = False
        for ep_data in eps_list:
            try:
                ep_num = int(ep_data.get('Episode', 0))
            except ValueError:
                continue
            key = (season, ep_num)
            rating = parse_float(ep_data.get('imdbRating'))
            if rating is None:
                rating = parse_float(services.fetch_rating_from_imdb(ep_data.get('imdbID')))
            votes = int(ep_data.get('imdbVotes').replace(',','')) if ep_data.get('imdbVotes') and ep_data.get('imdbVotes').replace(',','').isdigit() else None
            
            if key in existing_eps:
                ep = existing_eps[key]
                if rating is not None and ep.rating != rating:
                    ep.rating = rating; season_changed = True
                ep.votes = votes if votes is not None else ep.votes
                ep.last_checked = datetime.now(UTC).replace(tzinfo=None)
                ep.missing = (ep.rating is None)
                if getattr(ep, 'provisional', False) or getattr(ep, 'absent', False):
                    ep.provisional = False; ep.absent = False
                    if (real_ep_id := ep_data.get('imdbID')) and real_ep_id.startswith('tt'):
                        ep.imdb_id = real_ep_id
            else:
                episode = Episode(
                    show_id=show.id, season=season, episode=ep_num, title=ep_data.get('Title', 'No Title'),
                    rating=rating, imdb_id=ep_data.get('imdbID', 'No IMDb ID'), votes=votes,
                    last_checked=datetime.now(UTC).replace(tzinfo=None), missing=(rating is None),
                    provisional=False, absent=False
                )
                session.add(episode)
                season_changed = True

        if season_changed:
            session.commit()
            season_eps = session.query(Episode).filter_by(show_id=show.id, season=season).all()
            sig = compute_season_signature(season_eps)
            sh = get_or_create_season_hash(show.id, season)
            sh.signature = sig
            sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
            updated += 1

        imdb_eps = services.parse_imdb_season(imdb_id, season)
        if imdb_eps:
            existing_keys = {(e.season, e.episode) for e in session.query(Episode).filter_by(show_id=show.id, season=season).all()}
            imdb_keys = {(season, e['episode']) for e in imdb_eps}
            new_missing = imdb_keys - existing_keys
            if new_missing:
                for _, ep_num in sorted(new_missing):
                    meta = next((m for m in imdb_eps if m['episode']==ep_num), None)
                    if not meta: continue
                    placeholder = Episode(
                        show_id=show.id, season=season, episode=ep_num, title=meta['title'],
                        rating=meta['rating'], imdb_id=meta.get('imdb_episode_id') or f"{imdb_id}-S{season}E{ep_num}",
                        votes=meta['votes'], last_checked=datetime.now(UTC).replace(tzinfo=None),
                        missing=(meta['rating'] is None), absent=True, provisional=True, air_date=meta['air_date']
                    )
                    session.add(placeholder)
                session.commit()
                season_eps = session.query(Episode).filter_by(show_id=show.id, season=season).all()
                sig = compute_season_signature(season_eps)
                sh = get_or_create_season_hash(show.id, season)
                sh.signature = sig
                sh.last_computed = datetime.now(UTC).replace(tzinfo=None)
                updated += 1
    
    if updated:
        show.last_full_refresh = datetime.now(UTC).replace(tzinfo=None)
    show.last_updated = datetime.now(UTC).replace(tzinfo=None)
    session.commit()
    return jsonify({'updated_seasons': updated})

def process_metadata_refresh(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return jsonify({'error': 'Show not found'}), 404
    
    series_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    series_resp = services.throttled_omdb_get(series_url)
    if series_resp.status_code != 200:
        return jsonify({'error': 'Upstream error'}), 502
        
    sdata = safe_json(series_resp)
    if not sdata or sdata.get('Response') != 'True':
        return jsonify({'error': 'No data'}), 502
        
    try:
        new_total = int(sdata.get('totalSeasons', show.total_seasons))
    except Exception:
        new_total = show.total_seasons
    if new_total > show.total_seasons:
        show.total_seasons = new_total
        
    show.title = sdata.get('Title', show.title)
    show.genres = sdata.get('Genre', show.genres)
    show.year = sdata.get('Year', show.year)
    show.imdb_rating = parse_float(sdata.get('imdbRating')) or show.imdb_rating
    if sdata.get('imdbVotes') and sdata.get('imdbVotes').replace(',','').isdigit():
        show.imdb_votes = int(sdata.get('imdbVotes').replace(',',''))
    # Save poster if not already set or if we have a valid new one
    poster = sdata.get('Poster')
    if poster and poster != 'N/A':
        show.poster = poster
        
    show.last_updated = datetime.now(UTC).replace(tzinfo=None)
    session.commit()
    return jsonify({'status': 'metadata refreshed'})