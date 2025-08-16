import re

def sanitize_imdb_id(raw):
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

def safe_json(resp):
    try:
        return resp.json()
    except Exception:
        return None

def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None