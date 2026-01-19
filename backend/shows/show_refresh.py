import os
from flask import jsonify

from database import session, Show, Episode, SeasonHash
import services
from utils import parse_float, safe_json
from .show_helpers import (
    _parse_votes,
    _now_utc_naive,
    _update_show_metadata_from_omdb,
    _build_episode_from_omdb,
    _build_placeholder_episode,
    _recompute_season_signature
)


def process_missing_refresh(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return jsonify({'error': 'Show not found in DB'}), 404
    missing_eps = session.query(Episode).filter_by(show_id=show.id, rating=None).all()
    updated = 0
    updated_seasons = set()
    missing_by_season = {}
    for ep in missing_eps:
        missing_by_season.setdefault(ep.season, []).append(ep)

    for season, eps in missing_by_season.items():
        season_data = services.fetch_season_from_omdb(apiKey, imdb_id, season)
        if not season_data:
            continue
        season_eps = season_data.get('Episodes', [])
        omdb_map = {}
        for ep_data in season_eps:
            try:
                ep_num = int(ep_data.get('Episode', 0))
            except Exception:
                continue
            omdb_map[ep_num] = ep_data

        for ep in eps:
            ep_data = omdb_map.get(ep.episode)
            if not ep_data:
                continue
            rating = parse_float(ep_data.get('imdbRating'))
            if rating is None:
                scraped = services.fetch_rating_from_imdb(ep_data.get('imdbID'))
                rating = parse_float(scraped)
            if rating is not None:
                ep.rating = rating
                ep.missing = False
                ep.last_checked = _now_utc_naive()
                votes = _parse_votes(ep_data.get('imdbVotes'))
                if votes is not None:
                    ep.votes = votes
                updated += 1
                updated_seasons.add(season)
            else:
                ep.missing = True
                ep.last_checked = _now_utc_naive()

    if updated:
        session.commit()
        for season in updated_seasons:
            _recompute_season_signature(session, show.id, season)
        session.commit()
    return jsonify({'updated': updated})


def process_show_refresh(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        from .show_ingest import fetch_and_store_show
        return fetch_and_store_show(imdb_id, track_view=False)

    series_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    series_resp = services.throttled_omdb_get(series_url)
    sdata = safe_json(series_resp) if series_resp.status_code == 200 else None

    if sdata and sdata.get('Response') == 'True':
        _update_show_metadata_from_omdb(show, sdata)

    imdb_max = services.discover_imdb_max_season(imdb_id)
    if imdb_max and imdb_max > show.total_seasons:
        show.total_seasons = imdb_max
        session.commit()

    total = show.total_seasons
    updated = 0
    fetched_any = False
    for season in range(1, total + 1):
        season_data = services.fetch_season_from_omdb(apiKey, imdb_id, season)
        if not season_data:
            continue
        fetched_any = True

        eps_list = season_data.get('Episodes', []) or []
        quick_count = len(eps_list)
        quick_ratings = [val for ed in eps_list if (val := parse_float(ed.get('imdbRating'))) is not None]
        quick_avg = sum(quick_ratings) / len(quick_ratings) if quick_ratings else 0.0
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
                    meta = next((m for m in imdb_eps if m['episode'] == ep_num), None)
                    if not meta:
                        continue
                    placeholder = _build_placeholder_episode(show.id, season, meta, imdb_id)
                    session.add(placeholder)
                if new_missing:
                    session.commit()
                    _recompute_season_signature(session, show.id, season)
                    updated += 1
            continue

        existing_eps = {(e.season, e.episode): e for e in session.query(Episode).filter_by(show_id=show.id, season=season).all()}
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
            votes = _parse_votes(ep_data.get('imdbVotes'))

            if key in existing_eps:
                ep = existing_eps[key]
                if rating is not None and ep.rating != rating:
                    ep.rating = rating
                    season_changed = True
                ep.votes = votes if votes is not None else ep.votes
                ep.last_checked = _now_utc_naive()
                ep.missing = (ep.rating is None)
                if getattr(ep, 'provisional', False) or getattr(ep, 'absent', False):
                    ep.provisional = False
                    ep.absent = False
                    if (real_ep_id := ep_data.get('imdbID')) and real_ep_id.startswith('tt'):
                        ep.imdb_id = real_ep_id
            else:
                episode = _build_episode_from_omdb(show.id, season, ep_data, rating, votes, provisional=False, absent=False)
                session.add(episode)
                season_changed = True

        if season_changed:
            session.commit()
            _recompute_season_signature(session, show.id, season)
            updated += 1

        imdb_eps = services.parse_imdb_season(imdb_id, season)
        if imdb_eps:
            existing_keys = {(e.season, e.episode) for e in session.query(Episode).filter_by(show_id=show.id, season=season).all()}
            imdb_keys = {(season, e['episode']) for e in imdb_eps}
            new_missing = imdb_keys - existing_keys
            if new_missing:
                for _, ep_num in sorted(new_missing):
                    meta = next((m for m in imdb_eps if m['episode'] == ep_num), None)
                    if not meta:
                        continue
                    placeholder = _build_placeholder_episode(show.id, season, meta, imdb_id)
                    session.add(placeholder)
                session.commit()
                _recompute_season_signature(session, show.id, season)
                updated += 1

    if fetched_any:
        show.last_full_refresh = _now_utc_naive()
    show.last_updated = _now_utc_naive()
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

    _update_show_metadata_from_omdb(show, sdata)
    show.last_updated = _now_utc_naive()
    session.commit()
    return jsonify({'status': 'metadata refreshed'})
