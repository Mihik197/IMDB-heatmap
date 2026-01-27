from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, func, text
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session
from datetime import datetime, timedelta, UTC
from dotenv import load_dotenv
import os

load_dotenv()

# Database setup
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///shows.db')
IS_POSTGRES = DATABASE_URL.startswith('postgresql')

# Pool settings for remote PostgreSQL (handles idle connection timeouts)
engine_kwargs = {
    'pool_pre_ping': True,
    'pool_recycle': 300,
    'pool_size': 5,
    'max_overflow': 10,
} if IS_POSTGRES else {}

engine = create_engine(DATABASE_URL, **engine_kwargs)
Base = declarative_base()
Session = sessionmaker(bind=engine)
session = scoped_session(Session)  # Thread-safe session

# Staleness thresholds
SHOW_METADATA_STALE_DAYS = 7
EPISODE_STALE_DAYS = 30


# Models

class Show(Base):
    __tablename__ = 'shows'
    id = Column(Integer, primary_key=True, autoincrement=True)
    imdb_id = Column(String, unique=True, nullable=False)
    title = Column(String)
    total_seasons = Column(Integer)
    genres = Column(String)
    year = Column(String)
    imdb_rating = Column(Float)
    imdb_votes = Column(Integer)
    view_count = Column(Integer, default=0)
    poster = Column(String)
    last_full_refresh = Column(DateTime)
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
    votes = Column(Integer)
    last_checked = Column(DateTime)
    missing = Column(Boolean)
    absent = Column(Boolean)
    air_date = Column(DateTime)
    provisional = Column(Boolean)

class SeasonHash(Base):
    __tablename__ = 'season_hashes'
    id = Column(Integer, primary_key=True, autoincrement=True)
    show_id = Column(Integer, nullable=False)
    season = Column(Integer, nullable=False)
    signature = Column(String)
    last_computed = Column(DateTime, default=func.now(), onupdate=func.now())


# =============================================================================
# Database initialization & migrations
# =============================================================================

def init_db():
    """Create all tables."""
    Base.metadata.create_all(engine)

def ensure_columns():
    """Add missing columns to existing tables (SQLite + PostgreSQL compatible)."""
    with engine.connect() as conn:
        def column_exists(table, name):
            if IS_POSTGRES:
                result = conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = :table AND column_name = :col"
                ), {'table': table, 'col': name})
                return result.fetchone() is not None
            else:
                result = conn.execute(text(f"PRAGMA table_info({table})"))
                return any(row[1] == name for row in result.fetchall())

        # (column_name, sqlite_type, postgres_type)
        show_columns = [
            ('genres', 'TEXT', 'TEXT'),
            ('year', 'TEXT', 'TEXT'),
            ('imdb_rating', 'REAL', 'DOUBLE PRECISION'),
            ('imdb_votes', 'INTEGER', 'INTEGER'),
            ('last_full_refresh', 'DATETIME', 'TIMESTAMP'),
            ('view_count', 'INTEGER', 'INTEGER'),
            ('poster', 'TEXT', 'TEXT'),
        ]
        episode_columns = [
            ('votes', 'INTEGER', 'INTEGER'),
            ('last_checked', 'DATETIME', 'TIMESTAMP'),
            ('missing', 'BOOLEAN', 'BOOLEAN'),
            ('absent', 'BOOLEAN', 'BOOLEAN'),
            ('air_date', 'DATETIME', 'TIMESTAMP'),
            ('provisional', 'BOOLEAN', 'BOOLEAN'),
        ]

        for col, sqlite_type, pg_type in show_columns:
            if not column_exists('shows', col):
                col_type = pg_type if IS_POSTGRES else sqlite_type
                conn.execute(text(f"ALTER TABLE shows ADD COLUMN {col} {col_type}"))

        for col, sqlite_type, pg_type in episode_columns:
            if not column_exists('episodes', col):
                col_type = pg_type if IS_POSTGRES else sqlite_type
                conn.execute(text(f"ALTER TABLE episodes ADD COLUMN {col} {col_type}"))

        conn.commit()

def ensure_indices():
    """Create indices if they don't exist."""
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_episode_show_season_ep "
            "ON episodes (show_id, season, episode)"
        ))
        conn.commit()


# Helper functions

def _utc_now():
    return datetime.now(UTC).replace(tzinfo=None)

def compute_season_signature(episodes):
    """Compute a signature for detecting season changes."""
    confirmed = [e for e in episodes if not getattr(e, 'absent', False) and not getattr(e, 'provisional', False)]
    ratings = [e.rating for e in confirmed if e.rating is not None]
    count = len(confirmed)
    avg = sum(ratings) / len(ratings) if ratings else 0.0
    return f"{count}:{avg:.3f}"

def get_or_create_season_hash(show_id, season):
    rec = session.query(SeasonHash).filter_by(show_id=show_id, season=season).first()
    if not rec:
        rec = SeasonHash(show_id=show_id, season=season, signature='', last_computed=_utc_now())
        session.add(rec)
        session.commit()
    return rec

def is_show_metadata_stale(show: Show) -> bool:
    if not show.last_full_refresh:
        return True
    return (_utc_now() - show.last_full_refresh) > timedelta(days=SHOW_METADATA_STALE_DAYS)

def is_episode_stale(ep: Episode) -> bool:
    if ep.rating is None or not ep.last_checked:
        return True
    return (_utc_now() - ep.last_checked) > timedelta(days=EPISODE_STALE_DAYS)