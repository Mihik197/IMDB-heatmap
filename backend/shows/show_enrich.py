import threading
import traceback

from sqlalchemy.orm import sessionmaker

from database import session, Show, Episode, SeasonHash, engine
import services
from .show_helpers import _build_placeholder_episode, _recompute_season_signature, _now_utc_naive

# Track background enrichment progress for fast ingest shows (in-memory, non-persistent)
_enrichment_in_progress = set()
_enrichment_lock = threading.Lock()


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
            idx = {it['episode']: it for it in items}
            existing_eps = {e.episode: e for e in thread_session.query(Episode).filter_by(show_id=show.id, season=season).all()}
            season_changed = False
            season_mods = 0
            for ep_num, ep in existing_eps.items():
                meta = idx.get(ep_num)
                if not meta:
                    continue
                changed = False
                if meta.get('rating') is not None and ep.rating != meta.get('rating'):
                    ep.rating = meta.get('rating')
                    changed = True
                    ep.missing = (ep.rating is None)
                if meta.get('votes') is not None and ep.votes != meta.get('votes'):
                    ep.votes = meta.get('votes')
                    changed = True
                if meta.get('air_date') and ep.air_date != meta.get('air_date'):
                    ep.air_date = meta.get('air_date')
                    changed = True
                if changed:
                    ep.last_checked = _now_utc_naive()
                    season_changed = True
                    season_mods += 1
            existing_nums = set(existing_eps.keys())
            for meta in items:
                if meta['episode'] not in existing_nums:
                    placeholder = _build_placeholder_episode(show.id, season, meta, imdb_id)
                    thread_session.add(placeholder)
                    season_changed = True
                    season_mods += 1
            if season_changed:
                thread_session.commit()
                sig = _recompute_season_signature(thread_session, show.id, season)
                show.last_updated = _now_utc_naive()
                thread_session.commit()
                any_updates = True
                print(f"[enrich] updated season signature imdb_id={imdb_id} season={season} sig={sig} mods={season_mods}")
            else:
                print(f"[enrich] no season changes imdb_id={imdb_id} season={season}")
        if any_updates:
            show.last_updated = _now_utc_naive()
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
