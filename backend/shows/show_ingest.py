import os
import threading
from fastapi.responses import JSONResponse

from database import session, Show
import services
from utils import parse_float, safe_json
from .show_helpers import _parse_votes, _now_utc_naive, _build_episode_from_omdb, _recompute_season_signature
from .show_enrich import _imdb_enrich_show, _enrichment_in_progress, _enrichment_lock


def fetch_and_store_show(imdb_id, track_view=False):
    """
    Standard path to fetch a show from OMDb, scrape IMDb for missing ratings,
    and store everything in the database.
    """
    # Gate: if FAST_INGEST enabled use new path
    if os.getenv('FAST_INGEST') == '1':
        return fast_fetch_and_store_show(imdb_id, track_view=track_view)

    apiKey = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    response = services.throttled_omdb_get(url)
    if response.status_code != 200:
        return JSONResponse({'error': 'Failed to fetch show data'}, status_code=500)

    data = safe_json(response)
    if data is None:
        print(f"[fetch_show] JSON decode failure imdb_id={imdb_id}")
        return JSONResponse({'error': 'Upstream JSON parse failure'}, status_code=502)

    if data.get('Response') == 'True':
        show = Show(
            imdb_id=imdb_id,
            title=data['Title'],
            total_seasons=int(data['totalSeasons']),
            genres=data.get('Genre'),
            year=data.get('Year'),
            imdb_rating=parse_float(data.get('imdbRating')),
            imdb_votes=_parse_votes(data.get('imdbVotes')),
            poster=data.get('Poster'),
            last_full_refresh=_now_utc_naive(),
            view_count=1 if track_view else 0
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
                    votes = _parse_votes(ep_data.get('imdbVotes'))
                    episode = _build_episode_from_omdb(show.id, season_num, ep_data, rating, votes)
                    session.add(episode)
            session.commit()
            _recompute_season_signature(session, show.id, season_num)
            session.commit()

        session.commit()
        from app import get_show_data
        return get_show_data(imdb_id)

    return JSONResponse({'error': 'Failed to fetch show data'}, status_code=500)


def fast_fetch_and_store_show(imdb_id, track_view=False):
    """Fast ingest path: quickly stores OMDb data and spawns a background thread for IMDb enrichment."""
    apiKey = os.getenv('VITE_API_KEY')
    series_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    try:
        resp = services.throttled_omdb_get(series_url, timeout=10)
    except Exception:
        return JSONResponse({'error': 'Upstream failure'}, status_code=502)

    if resp.status_code != 200:
        return JSONResponse({'error': 'Upstream status'}, status_code=502)

    meta = safe_json(resp)
    if not meta or meta.get('Response') != 'True':
        return JSONResponse({'error': 'Not found'}, status_code=404)

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
        imdb_votes=_parse_votes(meta.get('imdbVotes')),
        poster=meta.get('Poster'),
        last_full_refresh=_now_utc_naive(),
        view_count=1 if track_view else 0
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
                votes = _parse_votes(ep_data.get('imdbVotes'))
                episode = _build_episode_from_omdb(show.id, season_num, ep_data, rating, votes, provisional=False, absent=False, air_date=None)
                session.add(episode)
        session.commit()
        _recompute_season_signature(session, show.id, season_num)
        session.commit()

    show.last_updated = _now_utc_naive()
    session.commit()

    with _enrichment_lock:
        _enrichment_in_progress.add(imdb_id)
    print(f"[fast_ingest] queued enrichment imdb_id={imdb_id} seasons={total_seasons}")
    threading.Thread(target=_imdb_enrich_show, args=(show.id, imdb_id, total_seasons), daemon=True).start()

    from app import get_show_data
    return get_show_data(imdb_id)
