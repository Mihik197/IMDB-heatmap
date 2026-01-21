# worker.py
import time
import os
import threading
from datetime import datetime, UTC

from database import session, Show, Episode, is_show_metadata_stale, is_episode_stale
import services
from utils import safe_json, parse_float

def maintenance_worker(interval_seconds=21600):  # 6 hours
    """Periodically refreshes stale metadata and missing episode ratings."""
    print("[maintenance] worker started.")
    while True:
        try:
            print("[maintenance] starting refresh cycle.")
            shows = session.query(Show).all()
            for show in shows:
                if is_show_metadata_stale(show):
                    print(f"[maintenance] metadata stale for {show.imdb_id}, refreshing.")
                    api_key = os.getenv('OMDB_API_KEY')
                    series_url = f'http://www.omdbapi.com/?apikey={api_key}&i={show.imdb_id}'
                    series_resp = services.throttled_omdb_get(series_url)
                    if series_resp.status_code == 200:
                        sdata = safe_json(series_resp)
                        if sdata and sdata.get('Response') == 'True':
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
                            show.last_updated = datetime.now(UTC).replace(tzinfo=None)
                            session.commit()
                
                stale_eps = [ep for ep in session.query(Episode).filter(Episode.show_id==show.id).all() if is_episode_stale(ep)]
                if stale_eps:
                    print(f"[maintenance] found {len(stale_eps)} stale episodes for {show.imdb_id}, checking missing.")
                    missing_eps = [ep for ep in stale_eps if ep.rating is None]
                    if missing_eps:
                        api_key = os.getenv('OMDB_API_KEY')
                        for ep in missing_eps:
                            season_data = services.fetch_season_from_omdb(api_key, show.imdb_id, ep.season)
                            if not season_data:
                                continue
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
                        session.commit()
            print("[maintenance] refresh cycle complete.")
        except Exception as e:
            print(f"[maintenance] error: {e}")
            session.rollback()
        time.sleep(interval_seconds)

def start_background_maintenance():
    if os.getenv('AUTO_REFRESH') == '1':
        t = threading.Thread(target=maintenance_worker, daemon=True)
        t.start()