import sys, os
import types
import re
import json
import pytest

# Ensure backend root (where app.py lives) on path
CURRENT_DIR = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(CURRENT_DIR, '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import app as backend

# We will monkeypatch httpx.get used inside fetch_rating_from_imdb

class DummyResp:
    def __init__(self, text='', status=200):
        self.text = text
        self.status_code = status
    def json(self):
        return json.loads(self.text)

@pytest.mark.parametrize("raw,expected", [
    ("tt1234567", "tt1234567"),
    (" tt7654321 ", "tt7654321"),
    ("tt7654321\\", None),
    ("tt12", None),
    ("badid", None),
])
def test_sanitize_imdb_id(raw, expected):
    assert backend.sanitize_imdb_id(raw) == expected

HTML_JSON_LD = '''<html><head><script type="application/ld+json">{"aggregateRating":{"ratingValue":"8.3"}}</script></head><body></body></html>'''
HTML_REGEX = '<html><body><script>var x = {"aggregateRating":{"ratingValue":"7.4"}};</script></body></html>'
HTML_META = '<html><head><meta itemprop="ratingValue" content="6.9"></head><body></body></html>'
HTML_SPAN = '<html><body><span>8.1</span></body></html>'

@pytest.mark.parametrize("html,expected", [
    (HTML_JSON_LD, '8.3'),
    (HTML_REGEX, '7.4'),
    (HTML_META, '6.9'),
    (HTML_SPAN, '8.1'),
])
def test_fetch_rating_from_imdb_fallbacks(monkeypatch, html, expected):
    calls = {'n':0}
    def fake_get(url, headers=None, timeout=10):
        calls['n'] += 1
        return DummyResp(text=html, status=200)
    monkeypatch.setattr(backend.services.httpx, 'get', fake_get)
    rating = backend.services.fetch_rating_from_imdb('tt9999999')
    assert rating == expected
    assert calls['n'] == 1

def test_fetch_rating_multiple_attempts(monkeypatch):
    seq = [DummyResp(status=500), DummyResp(status=500), DummyResp(text=HTML_META, status=200)]
    def fake_get(url, headers=None, timeout=10):
        return seq.pop(0)
    monkeypatch.setattr(backend.services.httpx, 'get', fake_get)
    rating = backend.services.fetch_rating_from_imdb('tt8888888')
    assert rating == '6.9'

def test_parse_imdb_season(monkeypatch):
    html = '''<div data-testid="episodes-list">
      <div data-testid="episodes-list-item">
        <span>S1.E1</span>
        <a href="/title/tt99999991/">Pilot</a>
        <div data-testid="ratingGroup--container"><span class="ipc-rating-star--rating">8.2</span><span class="voteCount">(1.3K)</span></div>
        <span>Fri Apr 03 2020</span>
      </div>
      <div data-testid="episodes-list-item">
        <span>S1.E2</span>
        <a href="/title/tt99999992/">Second</a>
        <div data-testid="ratingGroup--container"><span class="ipc-rating-star--rating">7.9</span><span class="voteCount">(987)</span></div>
        <span>Fri Apr 10 2020</span>
      </div>
    </div>'''
    class R: status_code=200; text=html
    def fake_get(url, timeout=12):
        return R()
    monkeypatch.setattr(backend.services, 'throttled_imdb_get', fake_get)
    eps = backend.services.parse_imdb_season('ttTESTID', 1)
    assert len(eps) == 2
    assert eps[0]['episode'] == 1 and eps[0]['rating'] == 8.2 and eps[0]['votes'] == 1300
    assert eps[1]['episode'] == 2 and eps[1]['votes'] == 987

