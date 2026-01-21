from __future__ import annotations

import logging
import os
import re
import json
import time
from typing import Any

import httpx
from bs4 import BeautifulSoup

from utils import safe_json, TTLCache, get_nested
from imdb_helpers import (
    IMDB_HEADERS,
    throttled_get,
    parse_imdb_season_json,
    parse_imdb_season_dom,
    parse_imdb_season_heuristic,
)


OMDB_MIN_INTERVAL: float = 0.25   # 250ms throttle for OMDB API
IMDB_MIN_INTERVAL: float = 0.5    # 500ms throttle for IMDB scraping
IMDB_SEASON_TTL: int = 300        # 5 minutes cache for season data
SEARCH_TTL: int = 60              # 1 minute cache for search results
TRENDING_TTL: int = 86400         # 24 hours cache for trending shows
RATING_HIT_TTL: int = 86400       # 24h cache for successful rating lookups
RATING_MISS_TTL: int = 3600       # 1h cache for failed rating lookups


logger = logging.getLogger(__name__)


_imdb_season_cache = TTLCache(IMDB_SEASON_TTL)
_search_cache = TTLCache(SEARCH_TTL)
_trending_cache = TTLCache(TRENDING_TTL)
_rating_cache = TTLCache(RATING_HIT_TTL)


# ============================================================================
# Throttled HTTP Helpers
# ============================================================================
def throttled_omdb_get(url: str, timeout: int = 10) -> httpx.Response:
    """Throttled GET request for OMDB API."""
    return throttled_get(url, OMDB_MIN_INTERVAL, timeout=timeout)


def throttled_imdb_get(url: str, timeout: int = 10) -> httpx.Response:
    """Throttled GET request for IMDB HTML pages."""
    return throttled_get(url, IMDB_MIN_INTERVAL, timeout=timeout, headers=IMDB_HEADERS)


# ============================================================================
# Trending Shows
# ============================================================================
def _parse_trending_from_json(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """
    Parse trending shows from IMDB's __NEXT_DATA__ JSON.

    Args:
        soup: BeautifulSoup object of the page.

    Returns:
        List of show dictionaries, or empty list if parsing fails.
    """
    shows: list[dict[str, Any]] = []

    next_data_script = soup.find('script', id='__NEXT_DATA__')
    if not next_data_script or not next_data_script.string:
        return shows

    try:
        data = json.loads(next_data_script.string.strip())
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse __NEXT_DATA__ JSON: %s", e)
        return shows

    # Try common paths for chart data
    paths_to_try = [
        ['props', 'pageProps', 'pageData', 'chartTitles', 'edges'],
        ['props', 'pageProps', 'chartTitles', 'edges'],
    ]

    chart_titles = None
    for path in paths_to_try:
        result = get_nested(data, path)
        if isinstance(result, list) and len(result) > 0:
            chart_titles = result
            break

    if not chart_titles:
        return shows

    for edge in chart_titles:
        node = edge.get('node', edge)
        if not node:
            continue

        imdb_id = node.get('id') or node.get('tconst')
        if not imdb_id:
            continue

        # Extract title
        title_text = node.get('titleText', {})
        title = title_text.get('text') if isinstance(title_text, dict) else None
        if not title:
            original_title = node.get('originalTitleText', {})
            title = original_title.get('text') if isinstance(original_title, dict) else None
        if not title:
            continue

        # Extract year
        release_year = node.get('releaseYear', {})
        year = str(release_year.get('year', '')) if isinstance(release_year, dict) else ''

        # Extract rating
        ratings = node.get('ratingsSummary', {})
        rating = ratings.get('aggregateRating') if isinstance(ratings, dict) else None

        # Extract poster
        primary_image = node.get('primaryImage', {})
        poster = primary_image.get('url') if isinstance(primary_image, dict) else None

        shows.append({
            'imdbID': imdb_id,
            'title': title,
            'year': year,
            'imdbRating': rating,
            'poster': poster,
        })

    return shows


def _parse_trending_from_dom(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """
    Fallback DOM parsing for trending shows.

    Args:
        soup: BeautifulSoup object of the page.

    Returns:
        List of show dictionaries.
    """
    shows: list[dict[str, Any]] = []

    chart_items = (
        soup.select('li.ipc-metadata-list-summary-item') or
        soup.select('.chart-container li')
    )

    for item in chart_items:
        # Find title link
        link = item.find('a', href=re.compile(r'/title/tt\d+'))
        if not link:
            continue

        href = link.get('href', '')
        match = re.search(r'/title/(tt\d+)', href)
        if not match:
            continue

        imdb_id = match.group(1)
        title = link.get_text(strip=True)
        if not title:
            continue

        # Find year
        year_span = item.find('span', class_=re.compile(r'year|date'))
        year = year_span.get_text(strip=True) if year_span else ''

        # Find rating
        rating: float | None = None
        rating_span = item.find('span', class_=re.compile(r'rating'))
        if rating_span:
            try:
                rating = float(rating_span.get_text(strip=True))
            except ValueError:
                pass

        # Find poster
        img = item.find('img')
        poster = img.get('src') if img else None

        shows.append({
            'imdbID': imdb_id,
            'title': title,
            'year': year,
            'imdbRating': rating,
            'poster': poster,
        })

    return shows


def get_trending_shows() -> list[dict[str, Any]]:
    """
    Scrape IMDB's most popular TV shows chart.

    Returns cached data if available, otherwise fetches fresh data.
    """
    # Check cache
    cached = _trending_cache.get('trending', require_value=True)
    if cached:
        return cached

    url = 'https://www.imdb.com/chart/tvmeter/'

    try:
        resp = httpx.get(url, timeout=15, headers=IMDB_HEADERS)
    except httpx.RequestError as e:
        logger.warning("Network error fetching trending shows: %s", e)
        return []

    if resp.status_code != 200:
        logger.warning("Trending shows request failed with status %d", resp.status_code)
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Try JSON parsing
    shows = _parse_trending_from_json(soup)

    # Fallback to DOM parsing
    if not shows:
        shows = _parse_trending_from_dom(soup)

    # Cache results
    if shows:
        _trending_cache.set('trending', shows)
        logger.info("Cached %d trending shows", len(shows))
    else:
        logger.warning("No trending shows found")

    return shows


# ============================================================================
# Season Parsing
# ============================================================================
def parse_imdb_season(imdb_id: str, season: int) -> list[dict[str, Any]]:
    """
    Parse IMDB season page to extract episodes with caching.

    Returns list of episode dicts with keys:
        season, episode, title, rating, votes, air_date, imdb_episode_id

    Skips specials and non-numeric episodes.
    """
    cache_key = (imdb_id, season)

    # Check cache
    cached = _imdb_season_cache.get(cache_key, require_value=True)
    if cached:
        return cached

    url = f"https://www.imdb.com/title/{imdb_id}/episodes/?season={season}"

    try:
        resp = throttled_imdb_get(url, timeout=12)
    except httpx.RequestError:
        logger.warning("Network error fetching season %d for %s", season, imdb_id)
        return []

    if resp.status_code != 200:
        logger.warning(
            "Season fetch failed: status=%d, imdb_id=%s, season=%d",
            resp.status_code, imdb_id, season
        )
        return []

    html = resp.text
    soup = BeautifulSoup(html, 'html.parser')
    items: list[dict[str, Any]] = []

    # Try JSON parsing
    if parse_imdb_season_json(soup, imdb_id, season, items):
        _imdb_season_cache.set(cache_key, items)
        return items

    # Fallback to DOM parsing
    parse_imdb_season_dom(soup, season, items)

    # Heuristic fallback
    if not items:
        parse_imdb_season_heuristic(soup, season, items)

    if not items:
        logger.warning(
            "Zero episodes found: imdb_id=%s, season=%d, html_length=%d",
            imdb_id, season, len(html)
        )
    else:
        if os.getenv('IMDB_PARSE_DEBUG') == '1':
            rated = sum(1 for x in items if x.get('rating') is not None)
            with_votes = sum(1 for x in items if x.get('votes') is not None)
            logger.debug(
                "DOM parsing success: imdb_id=%s, season=%d, episodes=%d, rated=%d, votes=%d",
                imdb_id, season, len(items), rated, with_votes
            )
        _imdb_season_cache.set(cache_key, items)

    return items


def discover_imdb_max_season(imdb_id: str) -> int | None:
    """
    Discover the maximum season number available for a show.

    Fetches the episodes page and parses the season dropdown.

    Args:
        imdb_id: IMDB ID of the show.

    Returns:
        Maximum season number, or None if discovery fails.
    """
    url = f"https://www.imdb.com/title/{imdb_id}/episodes/"

    try:
        resp = throttled_imdb_get(url, timeout=10)
    except httpx.RequestError:
        return None

    if resp.status_code != 200:
        return None

    soup = BeautifulSoup(resp.text, 'html.parser')
    max_season: int | None = None

    # Parse season dropdown options
    selectors = 'select[id*="season"], select[data-testid="episodes-season-select"] option'
    for opt in soup.select(selectors):
        try:
            val = int(opt.get('value') or opt.text.strip())
            if max_season is None or val > max_season:
                max_season = val
        except (ValueError, TypeError):
            continue

    return max_season


# ============================================================================
# Rating Scraping
# ============================================================================
def fetch_rating_from_imdb(imdb_id: str) -> str | None:
    """
    Fetch rating for an episode/show by scraping IMDB.

    Uses multiple fallback strategies: JSON-LD, regex, meta tags, heuristic spans.
    Includes caching and retry logic with exponential backoff.
    """
    caching_enabled = os.getenv('ENABLE_SCRAPE_CACHE') == '1'

    # Check cache
    if caching_enabled:
        cached = _rating_cache.get(imdb_id, require_value=False)
        if cached is not None:
            # Cache stores (value, found_bool) tuple
            return cached[0] if cached[1] else None

    url = f'https://www.imdb.com/title/{imdb_id}/'
    backoff_delays = [1, 2, 4]
    result: str | None = None

    for attempt, delay in enumerate(backoff_delays, start=1):
        try:
            resp = httpx.get(url, headers=IMDB_HEADERS, timeout=10)
        except httpx.RequestError:
            logger.warning("Network error (attempt %d) for %s", attempt, imdb_id)
            time.sleep(delay)
            continue

        if resp.status_code != 200:
            logger.warning(
                "Request failed (attempt %d): status=%d, imdb_id=%s",
                attempt, resp.status_code, imdb_id
            )
            time.sleep(delay)
            continue

        html = resp.text
        soup = BeautifulSoup(html, 'html.parser')

        # Strategy 1: JSON-LD structured data
        result = _extract_rating_from_json_ld(soup, imdb_id)
        if result:
            break

        # Strategy 2: Regex fallback
        result = _extract_rating_from_regex(html, imdb_id)
        if result:
            break

        # Strategy 3: Meta tag fallback
        result = _extract_rating_from_meta(soup, imdb_id)
        if result:
            break

        # Strategy 4: Heuristic span search
        result = _extract_rating_from_span(soup, imdb_id)
        if result:
            break

        time.sleep(delay)

    # Cache result
    if caching_enabled:
        found = result is not None
        ttl = RATING_HIT_TTL if found else RATING_MISS_TTL
        _rating_cache.set(imdb_id, (result, found), ttl=ttl)

    return result


def _extract_rating_from_json_ld(soup: BeautifulSoup, imdb_id: str) -> str | None:
    """Extract rating from JSON-LD structured data."""
    for tag in soup.find_all('script', type='application/ld+json'):
        try:
            data = json.loads(tag.string.strip())
        except (json.JSONDecodeError, AttributeError):
            continue

        candidates = data if isinstance(data, list) else [data]
        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            agg = obj.get('aggregateRating')
            if isinstance(agg, dict):
                val = agg.get('ratingValue') or agg.get('rating')
                if val:
                    logger.debug("JSON-LD rating %s for %s", val, imdb_id)
                    return str(val)
    return None


def _extract_rating_from_regex(html: str, imdb_id: str) -> str | None:
    """Extract rating using regex pattern matching."""
    pattern = r'"aggregateRating"\s*:\s*\{[^}]*?"ratingValue"\s*:\s*"?(\d+\.?\d*)"?'
    match = re.search(pattern, html)
    if match:
        logger.debug("Regex rating %s for %s", match.group(1), imdb_id)
        return match.group(1)
    return None


def _extract_rating_from_meta(soup: BeautifulSoup, imdb_id: str) -> str | None:
    """Extract rating from meta itemprop tag."""
    meta = soup.find('meta', attrs={'itemprop': 'ratingValue'})
    if meta and meta.get('content'):
        logger.debug("Meta rating %s for %s", meta['content'], imdb_id)
        return meta['content']
    return None


def _extract_rating_from_span(soup: BeautifulSoup, imdb_id: str) -> str | None:
    """Extract rating via heuristic span search."""
    span = soup.find('span', string=re.compile(r'^[0-9]\.[0-9]$'))
    if span:
        txt = span.text.strip()
        if re.match(r'^\d\.\d$', txt):
            logger.debug("Heuristic span rating %s for %s", txt, imdb_id)
            return txt
    return None


# ============================================================================
# OMDB API
# ============================================================================
def fetch_season_from_omdb(
    api_key: str,
    imdb_id: str,
    season_number: int
) -> dict[str, Any] | None:
    """Fetch season data from OMDB API."""
    url = f'http://www.omdbapi.com/?apikey={api_key}&i={imdb_id}&season={season_number}'
    resp = throttled_omdb_get(url)

    if resp.status_code != 200:
        return None

    data = safe_json(resp)
    if data is None or data.get('Response') != 'True':
        return None

    return data