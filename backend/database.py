from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, func
from sqlalchemy.orm import declarative_base 
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta, UTC
import sqlite3

# database setup
DATABASE_URL = "sqlite:///shows.db"
engine = create_engine(DATABASE_URL)
Base = declarative_base()
Session = sessionmaker(bind=engine)
session = Session()

class Show(Base):
    __tablename__ = 'shows'
    id = Column(Integer, primary_key=True, autoincrement=True)
    imdb_id = Column(String, unique=True, nullable=False)
    title = Column(String)
    total_seasons = Column(Integer)
    # new metadata fields
    genres = Column(String)              # comma separated
    year = Column(String)                # original year string from OMDb (may contain range)
    imdb_rating = Column(Float)          # series aggregate rating
    imdb_votes = Column(Integer)         # aggregate vote count
    view_count = Column(Integer, default=0)  # track app-level popularity
    poster = Column(String)              # poster URL from OMDb
    last_full_refresh = Column(DateTime) # when full metadata + all seasons last fetched
    last_updated = Column(DateTime, default=func.now(), onupdate=func.now())

class Episode(Base):
    __tablename__ = 'episodes'
    id = Column(Integer, primary_key=True, autoincrement=True)
    show_id = Column(Integer)
    season = Column(Integer)
    episode = Column(Integer)
    title = Column(String)
    rating = Column(Float)
    imdb_id = Column(String)
    votes = Column(Integer)              # episode vote count if obtainable
    last_checked = Column(DateTime)      # last time rating/votes checked
    missing = Column(Boolean)            # True if rating missing at last check
    absent = Column(Boolean)             # True if episode not yet in OMDb but found via IMDb list
    air_date = Column(DateTime)          # Air date if parsed
    provisional = Column(Boolean)        # True if sourced only from IMDb (not yet confirmed by OMDb)

class SeasonHash(Base):
    __tablename__ = 'season_hashes'
    id = Column(Integer, primary_key=True, autoincrement=True)
    show_id = Column(Integer, nullable=False)
    season = Column(Integer, nullable=False)
    signature = Column(String)           # e.g. f"{count}:{avg:.3f}" to detect changes quickly
    last_computed = Column(DateTime, default=func.now(), onupdate=func.now())

def init_db():
    """Initialize database tables"""
    Base.metadata.create_all(engine)


# Simple runtime migration: add missing columns if DB created earlier
def ensure_columns():
    import sqlite3
    raw_conn = engine.raw_connection()
    cur = raw_conn.cursor()
    def column_exists(table, name):
        cur.execute(f"PRAGMA table_info({table})")
        return any(row[1] == name for row in cur.fetchall())
    # shows table additions
    new_show_cols = [
        ('genres','TEXT'), ('year','TEXT'), ('imdb_rating','REAL'), ('imdb_votes','INTEGER'), ('last_full_refresh','DATETIME'),
        ('view_count','INTEGER'), ('poster','TEXT')
    ]
    for col, typ in new_show_cols:
        if not column_exists('shows', col):
            cur.execute(f"ALTER TABLE shows ADD COLUMN {col} {typ}")
    # episodes table additions
    new_ep_cols = [
    ('votes','INTEGER'), ('last_checked','DATETIME'), ('missing','BOOLEAN'), ('absent','BOOLEAN'), ('air_date','DATETIME'), ('provisional','BOOLEAN')
    ]
    for col, typ in new_ep_cols:
        if not column_exists('episodes', col):
            cur.execute(f"ALTER TABLE episodes ADD COLUMN {col} {typ}")
    # season_hashes table (already created by metadata if absent)
    raw_conn.commit()
    cur.close()
    raw_conn.close()

# Indices (idempotent)
def ensure_indices():
    raw_conn = engine.raw_connection()
    cur = raw_conn.cursor()
    # composite index for faster episode lookup
    cur.execute("CREATE INDEX IF NOT EXISTS idx_episode_show_season_ep ON episodes (show_id, season, episode)")
    raw_conn.commit()
    cur.close()
    raw_conn.close()


SHOW_METADATA_STALE_DAYS = 7
EPISODE_STALE_DAYS = 30

def compute_season_signature(episodes):
    # Only consider episodes confirmed by OMDb (not absent/provisional) for signature stability
    confirmed = [e for e in episodes if not getattr(e, 'absent', False) and not getattr(e, 'provisional', False)]
    ratings = [e.rating for e in confirmed if e.rating is not None]
    count = len(confirmed)
    avg = sum(ratings)/len(ratings) if ratings else 0.0
    return f"{count}:{avg:.3f}"

def get_or_create_season_hash(show_id, season):
    rec = session.query(SeasonHash).filter_by(show_id=show_id, season=season).first()
    if not rec:
        rec = SeasonHash(
            show_id=show_id,
            season=season,
            signature='',
            last_computed=datetime.now(UTC).replace(tzinfo=None)
        )
        session.add(rec)
        session.commit()
    return rec

def is_show_metadata_stale(show: Show):
    if not show.last_full_refresh:
        return True
    return (datetime.now(UTC).replace(tzinfo=None) - show.last_full_refresh) > timedelta(days=SHOW_METADATA_STALE_DAYS)

def is_episode_stale(ep: Episode):
    if ep.rating is None:
        return True
    if not ep.last_checked:
        return True
    return (datetime.now(UTC).replace(tzinfo=None) - ep.last_checked) > timedelta(days=EPISODE_STALE_DAYS)
