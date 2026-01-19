import datetime
from datetime import UTC

from database import (
    session,
    Episode,
    SeasonHash,
    get_or_create_season_hash,
    compute_season_signature
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
