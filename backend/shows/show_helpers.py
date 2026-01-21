import datetime
from fastapi import Response
from fastapi.responses import JSONResponse
from datetime import UTC

from database import (
    session,
    Episode,
    SeasonHash,
    get_or_create_season_hash,
    compute_season_signature,
    Show,
    is_episode_stale,
    is_show_metadata_stale
)
from utils import parse_float


def _parse_votes(votes_str):
    if votes_str and votes_str.replace(',', '').isdigit():
        return int(votes_str.replace(',', ''))
    return None


def _now_utc_naive():
    return datetime.datetime.now(UTC).replace(tzinfo=None)


def _update_show_metadata_from_omdb(show, sdata):
    show.title = sdata.get('Title', show.title)
    try:
        new_total = int(sdata.get('totalSeasons', show.total_seasons))
    except Exception:
        new_total = show.total_seasons
    show.genres = sdata.get('Genre', show.genres)
    show.year = sdata.get('Year', show.year)
    show.imdb_rating = parse_float(sdata.get('imdbRating')) or show.imdb_rating
    votes = _parse_votes(sdata.get('imdbVotes'))
    if votes is not None:
        show.imdb_votes = votes
    poster = sdata.get('Poster')
    if poster and poster != 'N/A':
        show.poster = poster
    if new_total > show.total_seasons:
        show.total_seasons = new_total


def _build_episode_from_omdb(show_id, season_num, ep_data, rating, votes, provisional=False, absent=False, air_date=None):
    return Episode(
        show_id=show_id,
        season=season_num,
        episode=int(ep_data.get('Episode', 0)),
        title=ep_data.get('Title', 'No Title'),
        rating=rating,
        imdb_id=ep_data.get('imdbID', 'No IMDb ID'),
        votes=votes,
        last_checked=_now_utc_naive(),
        missing=(rating is None),
        provisional=provisional,
        absent=absent,
        air_date=air_date
    )


def _build_placeholder_episode(show_id, season, meta, imdb_id):
    return Episode(
        show_id=show_id,
        season=season,
        episode=meta['episode'],
        title=meta['title'],
        rating=meta['rating'],
        imdb_id=meta.get('imdb_episode_id') or f"{imdb_id}-S{season}E{meta['episode']}",
        votes=meta['votes'],
        last_checked=_now_utc_naive(),
        missing=(meta['rating'] is None),
        absent=True,
        provisional=True,
        air_date=meta.get('air_date')
    )


def _recompute_season_signature(db_session, show_id, season_num):
    season_eps = db_session.query(Episode).filter_by(show_id=show_id, season=season_num).all()
    sig = compute_season_signature(season_eps)
    if db_session is session:
        sh = get_or_create_season_hash(show_id, season_num)
    else:
        sh = db_session.query(SeasonHash).filter_by(show_id=show_id, season=season_num).first()
    if not sh:
        sh = SeasonHash(show_id=show_id, season=season_num, signature='', last_computed=_now_utc_naive())
        db_session.add(sh)
    sh.signature = sig
    sh.last_computed = _now_utc_naive()
    return sig


def get_show_data(imdb_id, if_none_match=None, enrichment_set=None, missing_refresh_set=None):
    """Fetch show data from DB and format it for the API response."""
    show = session.query(Show).filter_by(imdb_id=imdb_id).first()
    if not show:
        return JSONResponse({'error': 'Show not found in DB'}, status_code=404)

    try:
        session.refresh(show)
    except Exception:
        pass  # Handle detached instance error if occurs

    episodes = session.query(Episode).filter_by(show_id=show.id).order_by(Episode.season, Episode.episode).all()
    incomplete = any(ep.rating is None for ep in episodes)
    metadata_stale = is_show_metadata_stale(show)
    episodes_stale_count = sum(1 for ep in episodes if is_episode_stale(ep))
    absent_count = sum(1 for ep in episodes if getattr(ep, 'absent', False))
    provisional_count = sum(1 for ep in episodes if getattr(ep, 'provisional', False))
    enrichment_set = enrichment_set or set()
    missing_refresh_set = missing_refresh_set or set()

    etag_val = f"{int(show.last_updated.timestamp()) if show.last_updated else 0}:{len(episodes)}:{show.total_seasons}:{absent_count}"
    if if_none_match == etag_val:
        return Response(status_code=304, headers={'ETag': etag_val})

    payload = {
        'title': show.title, 'imdbID': show.imdb_id, 'totalSeasons': show.total_seasons,
        'genres': show.genres, 'year': show.year, 'imdbRating': show.imdb_rating,
        'imdbVotes': show.imdb_votes,
        'lastFullRefresh': show.last_full_refresh.isoformat() if show.last_full_refresh else None,
        'incomplete': incomplete, 'metadataStale': metadata_stale,
        'episodesStaleCount': episodes_stale_count,
        'partialData': (provisional_count > 0 or absent_count > 0 or (imdb_id in enrichment_set) or (imdb_id in missing_refresh_set)),
        'missingRefreshInProgress': (imdb_id in missing_refresh_set),
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

    return JSONResponse(
        content=payload,
        headers={'ETag': etag_val, 'Cache-Control': 'public, max-age=5'}
    )
