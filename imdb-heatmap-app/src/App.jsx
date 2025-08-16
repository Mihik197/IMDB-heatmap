/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react'
import './App.css'
import SearchBar from './SearchBar'
import HeatMap from './HeatMap'
import Header from './Header'
import RecentShows from './RecentShows'

function App() {
  const [ searchQuery, setSearchQuery ] = useState('')
  const [ currentID, setCurrentID ] = useState(null)
  const [ data, setData ] = useState(null) // show with full episodes metadata from /getShow
  const [ baseMeta, setBaseMeta ] = useState(null) // raw getShowMeta / title response
  const [ loadingMeta, setLoadingMeta ] = useState(false)
  const [ loadingEpisodes, setLoadingEpisodes ] = useState(false)
  const [ refreshingMissing, setRefreshingMissing ] = useState(false)
  const [ error, setError ] = useState(null)
  const episodesAbortRef = useRef(null)

  const handleSearch = (item) => {
    if (!item) return;
    if (episodesAbortRef.current) { episodesAbortRef.current.abort(); }
    setError(null);
    setData(null);
    setBaseMeta(null);
    setLoadingMeta(true);
    setLoadingEpisodes(false);
    if (item.imdbID) {
      setCurrentID(item.imdbID);
      setSearchQuery(item.title || '');
    } else {
      setCurrentID(null);
      setSearchQuery(item.title);
    }
  }

  // recent shows list from enriched getShow
  useEffect(() => {
    if (!data || !data.imdbID) return;
    try {
      const raw = localStorage.getItem('recentShows');
      const list = raw ? JSON.parse(raw) : [];
      const next = [{ imdbID: data.imdbID, title: data.title || baseMeta?.Title, poster: baseMeta?.Poster, year: data.year || baseMeta?.Year }, ...list.filter(i => i.imdbID !== data.imdbID)];
      localStorage.setItem('recentShows', JSON.stringify(next));
    } catch (_) { /* ignore */ }
  }, [data?.imdbID])

  // Metadata-first then episodes fetch
  useEffect(() => {
    const metaController = new AbortController();
    if (currentID) {
      // 1. fetch show meta quickly
      fetch(`http://localhost:5000/getShowMeta?imdbID=${currentID}`, { signal: metaController.signal })
        .then(r => r.json())
        .then(meta => {
          setLoadingMeta(false);
          if (meta && !meta.error) {
            setBaseMeta(meta);
            // 2. fetch heavy episodes
            setLoadingEpisodes(true);
            const epController = new AbortController();
            episodesAbortRef.current = epController;
            fetch(`http://localhost:5000/getShow?imdbID=${currentID}`, { signal: epController.signal })
              .then(r => r.json())
              .then(full => { if (!epController.signal.aborted) { if (full && !full.error) setData(full); else setError(full?.error || 'Fetch failed'); } })
              .catch(e => { if (e.name !== 'AbortError') setError('Fetch failed'); })
              .finally(() => { if (!epController.signal.aborted) setLoadingEpisodes(false); });
          } else {
            setBaseMeta(null);
            setError(meta?.error || 'Metadata fetch failed');
          }
        })
        .catch(e => { if (e.name !== 'AbortError') { setLoadingMeta(false); setError('Metadata fetch failed'); } });
      return () => { metaController.abort(); if (episodesAbortRef.current) episodesAbortRef.current.abort(); };
    }
    if (searchQuery && !currentID) {
      // Title-based search fallback (older path)
      fetch(`http://localhost:5000/getShowByTitle?title=${encodeURIComponent(searchQuery)}`, { signal: metaController.signal })
        .then(r => r.json())
        .then(meta => {
          setLoadingMeta(false);
            setBaseMeta(meta);
            if (meta && meta.imdbID) {
              setCurrentID(meta.imdbID);
            }
        })
        .catch(e => { if (e.name !== 'AbortError') { setLoadingMeta(false); setError('Fetch failed'); } });
      return () => metaController.abort();
    }
  }, [currentID, searchQuery])

  const refreshMissing = () => {
    if (!data?.imdbID) return; setRefreshingMissing(true);
    fetch(`http://localhost:5000/refresh/missing?imdbID=${data.imdbID}`, { method: 'POST' })
      .then(r => r.json())
      .then(() => fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`))
      .then(r => r.json())
      .then(full => setData(full))
      .catch(() => {/* silent */})
      .finally(() => setRefreshingMissing(false));
  }

  const refreshAll = () => {
    if (!data?.imdbID) return; setRefreshingMissing(true);
    fetch(`http://localhost:5000/refresh/show?imdbID=${data.imdbID}`, { method: 'POST' })
      .then(r => r.json())
      .then(() => fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`))
      .then(r => r.json())
      .then(full => setData(full))
      .finally(() => setRefreshingMissing(false));
  }

  const incomplete = data?.incomplete;
  const hasMissing = incomplete;
  const stale = (data?.metadataStale) || (data?.episodesStaleCount > 0);
  const stillLoading = loadingMeta || loadingEpisodes;
  const partialData = data?.partialData; // new flag for fast ingest background enrichment
  const pollStopRef = useRef(false);
  const etagRef = useRef(null); // track last ETag to avoid unnecessary DOM churn

  useEffect(() => {
    if (!data?.imdbID || !partialData) { pollStopRef.current = true; return; }
    pollStopRef.current = false;
    let attempts = 0;
    const maxAttempts = 20; // ~100s if interval 5s
    const intervalMs = 5000;
    const tick = () => {
      if (pollStopRef.current) return;
      attempts += 1;
      fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`, { headers: { 'Cache-Control': 'no-cache', ...(etagRef.current ? { 'If-None-Match': etagRef.current } : {}) } })
        .then(async r => {
          if (r.status === 304) {
            return null; // no change
          }
            const incoming = await r.json();
            // update ETag if present
            const newEtag = r.headers.get('ETag');
            if (newEtag) etagRef.current = newEtag;
            return incoming;
        })
        .then(full => {
          if (full && !full.error) {
            // Shallow compare episodes length + lastUpdated-like markers to avoid flicker
            if (!data || data.episodes.length !== full.episodes.length) {
              setData(full);
            } else {
              // Merge ratings without replacing whole object to reduce React subtree resets
              const merged = { ...data };
              let changed = false;
              merged.episodes = data.episodes.map((ep, idx) => {
                const next = full.episodes[idx];
                if (!next) return ep;
                if (ep.rating !== next.rating || ep.votes !== next.votes || ep.title !== next.title) {
                  changed = true;
                  return { ...ep, rating: next.rating, votes: next.votes, title: next.title };
                }
                return ep;
              });
              if (changed || merged.partialData !== full.partialData) {
                merged.partialData = full.partialData;
                merged.incomplete = full.incomplete;
                merged.metadataStale = full.metadataStale;
                merged.episodesStaleCount = full.episodesStaleCount;
                setData(merged);
              }
            }
            if (full && !full.partialData) {
              pollStopRef.current = true; // done
            }
          }
        })
        .catch(() => {/* ignore */});
      if (attempts < maxAttempts && !pollStopRef.current) {
        setTimeout(tick, intervalMs);
      }
    };
    const id = setTimeout(tick, intervalMs);
    return () => { pollStopRef.current = true; clearTimeout(id); };
  }, [partialData, data?.imdbID])

  return (
    <div className="app-root">
      <Header />
      <div className="app-container">
        <SearchBar onSearch={handleSearch} />
        {error && <p className="error-msg" role="alert">{error}</p>}
        {baseMeta && !baseMeta.error && (
          <div className="show-container">
            <div className="show-details">
              <div className="poster">
                {baseMeta.Poster && baseMeta.Poster !== 'N/A' && <img src={baseMeta.Poster} alt={`${baseMeta.Title} Poster`} />}
              </div>
              <div className="info">
                <h2 className="show-heading">{baseMeta.Title} {incomplete && <span className="badge-incomplete" title="Some episodes still missing ratings">Incomplete data</span>} {partialData && <span className="badge-partial" title="Background enrichment in progress">Enriching…</span>}</h2>
                <p className="meta-year">{baseMeta.Year}</p>
                {baseMeta.Plot && <p className="plot">{baseMeta.Plot}</p>}
                {hasMissing && <button className="btn-refresh-missing" onClick={refreshMissing} disabled={refreshingMissing}>{refreshingMissing ? 'Refreshing…' : 'Refresh missing ratings'}</button>}
                {stale && <button className="btn-refresh-generic" onClick={refreshAll} disabled={refreshingMissing}>{refreshingMissing ? 'Refreshing…' : 'Refresh data'}</button>}
                {partialData && <button className="btn-refresh-generic" style={{marginLeft:'.5rem'}} onClick={() => {
                  if (!data?.imdbID) return;
                  fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`, { headers: { 'Cache-Control':'no-cache', ...(etagRef.current ? { 'If-None-Match': etagRef.current } : {}) } })
                    .then(async r => { if (r.status === 304) return null; const body = await r.json(); const newEtag = r.headers.get('ETag'); if (newEtag) etagRef.current = newEtag; return body; })
                    .then(full => { if (full && !full.error) setData(full); });
                }}>Check now</button>}
                {loadingEpisodes && <div className="episodes-loading" aria-live="polite">Loading episode ratings…</div>}
              </div>
            </div>
            <div className="heatmap-container-scroll">
              <div className="legend-wrap"></div>
              {partialData && !loadingEpisodes && <div className="partial-hint" aria-live="polite">Background IMDb enrichment running… latest ratings will appear automatically.</div>}
              {data && data.episodes && !loadingEpisodes && <HeatMap data={data} baseMeta={baseMeta} />}
              {loadingEpisodes && <div className="heatmap-skeleton" aria-hidden="true">Preparing heatmap…</div>}
            </div>
          </div>
        )}
        {baseMeta && baseMeta.error && <p className="error-msg" role="alert">{baseMeta.error}</p>}
        {stillLoading && !baseMeta && <div className="loading skeleton">Loading…</div>}
        <RecentShows onSelect={(title) => handleSearch({ title })} />
      </div>
    </div>
  )
}

export default App
