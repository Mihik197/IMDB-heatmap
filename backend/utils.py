"""
Generic utility functions and classes for the IMDB Heatmap backend.
"""
from __future__ import annotations

import re
import time
from typing import Any, Hashable


# ============================================================================
# ID Validation
# ============================================================================
def sanitize_imdb_id(raw: str | None) -> str | None:
    """Sanitize and validate an IMDB ID."""
    if not raw:
        return None
    cleaned = raw.strip().strip('"').strip("'").strip()
    # Reject if contains any path/control characters
    if any(ch in cleaned for ch in ['\\\n', '\\r', '/', '\\']):
        return None
    # Must match exact pattern without trimming arbitrary trailing punctuation
    if not re.match(r'^tt\d{6,9}$', cleaned):
        return None
    return cleaned


# ============================================================================
# JSON/Response Helpers
# ============================================================================
def safe_json(resp: Any) -> dict | list | None:
    """Safely parse JSON from an HTTP response."""
    try:
        return resp.json()
    except Exception:
        return None


def parse_float(value: Any) -> float | None:
    """Safely parse a value to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def get_nested(data: dict[str, Any], path: list[str]) -> Any | None:
    """Safely navigate a nested dictionary by key path."""
    current = data
    for key in path:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


# ============================================================================
# Caching
# ============================================================================
class TTLCache:
    """Simple TTL-based in-memory cache with optional per-entry TTL override."""

    def __init__(self, default_ttl: int) -> None:
        """Initialize cache with a default TTL."""
        self._cache: dict[Hashable, tuple[float, Any, int]] = {}
        self._default_ttl = default_ttl

    def get(self, key: Hashable, require_value: bool = True) -> Any | None:
        """Retrieve a value from cache if not expired."""
        entry = self._cache.get(key)
        if entry is None:
            return None
        timestamp, value, ttl = entry
        if (time.time() - timestamp) >= ttl:
            return None
        if require_value and not value:
            return None
        return value

    def set(self, key: Hashable, value: Any, ttl: int | None = None) -> None:
        """Store a value in cache with optional custom TTL."""
        effective_ttl = ttl if ttl is not None else self._default_ttl
        self._cache[key] = (time.time(), value, effective_ttl)

    def clear(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()