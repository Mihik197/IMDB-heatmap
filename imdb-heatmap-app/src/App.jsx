/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react'
import SearchBar from './SearchBar'
import HeatMap from './HeatMap'
import Header from './Header'
import RecentShows from './RecentShows'

function App() {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentID, setCurrentID] = useState(null)
  const [data, setData] = useState(null)
  const [baseMeta, setBaseMeta] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [refreshingMissing, setRefreshingMissing] = useState(false)
  const [error, setError] = useState(null)
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

  useEffect(() => {
    if (!data || !data.imdbID) return;
    try {
      const raw = localStorage.getItem('recentShows');
      const list = raw ? JSON.parse(raw) : [];
      const next = [{ imdbID: data.imdbID, title: data.title || baseMeta?.Title, poster: baseMeta?.Poster, year: data.year || baseMeta?.Year }, ...list.filter(i => i.imdbID !== data.imdbID)];
      localStorage.setItem('recentShows', JSON.stringify(next));
    } catch (_) { /* ignore */ }
  }, [data?.imdbID])

  useEffect(() => {
    const metaController = new AbortController();
    if (currentID) {
      fetch(`http://localhost:5000/getShowMeta?imdbID=${currentID}`, { signal: metaController.signal })
        .then(r => r.json())
        .then(meta => {
          setLoadingMeta(false);
          if (meta && !meta.error) {
            setBaseMeta(meta);
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
      .catch(() => {/* silent */ })
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
  const partialData = data?.partialData;
  const pollStopRef = useRef(false);
  const etagRef = useRef(null);

  useEffect(() => {
    if (!data?.imdbID || !partialData) { pollStopRef.current = true; return; }
    pollStopRef.current = false;
    let attempts = 0;
    const maxAttempts = 20;
    const intervalMs = 5000;
    const tick = () => {
      if (pollStopRef.current) return;
      attempts += 1;
      fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`, { headers: { 'Cache-Control': 'no-cache', ...(etagRef.current ? { 'If-None-Match': etagRef.current } : {}) } })
        .then(async r => {
          if (r.status === 304) {
            return null;
          }
          const incoming = await r.json();
          const newEtag = r.headers.get('ETag');
          if (newEtag) etagRef.current = newEtag;
          return incoming;
        })
        .then(full => {
          if (full && !full.error) {
            if (!data || data.episodes.length !== full.episodes.length) {
              setData(full);
            } else {
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
              pollStopRef.current = true;
            }
          }
        })
        .catch(() => {/* ignore */ });
      if (attempts < maxAttempts && !pollStopRef.current) {
        setTimeout(tick, intervalMs);
      }
    };
    const id = setTimeout(tick, intervalMs);
    return () => { pollStopRef.current = true; clearTimeout(id); };
  }, [partialData, data?.imdbID])

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-6">
        <SearchBar onSearch={handleSearch} />
        {error && <p className="text-danger font-mono text-sm font-semibold mt-3" role="alert">{error}</p>}
        {baseMeta && !baseMeta.error && (
          <div className="mt-6 p-5 bg-surface border border-border rounded shadow-sm">
            <div className="flex gap-5 mb-5 items-start flex-wrap">
              <div className="shrink-0">
                {baseMeta.Poster && baseMeta.Poster !== 'N/A' && (
                  <img src={baseMeta.Poster} alt={`${baseMeta.Title} Poster`} className="w-[180px] max-w-full rounded" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold mb-1 flex items-center flex-wrap gap-2">
                  {baseMeta.Title}
                  {incomplete && (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wide bg-[#302414] text-[#d9a45e] border border-[#4a3722] rounded" title="Some episodes still missing ratings">
                      Incomplete data
                    </span>
                  )}
                  {partialData && (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wide bg-[#1e2d38] text-[#7fb9d8] border border-[#2d4856] rounded" title="Background enrichment in progress">
                      Enriching…
                    </span>
                  )}
                </h2>
                <p className="text-text-muted text-xs tracking-wide mb-3">{baseMeta.Year}</p>
                {baseMeta.Plot && <p className="text-sm leading-relaxed max-w-[60ch]">{baseMeta.Plot}</p>}
                <div className="flex flex-wrap gap-2 mt-4">
                  {hasMissing && (
                    <button
                      className="px-3 py-2 text-[10px] font-mono font-semibold tracking-wide bg-[#253035] text-text border border-[#354247] rounded cursor-pointer hover:bg-[#2d3a40] disabled:opacity-55 disabled:cursor-default"
                      onClick={refreshMissing}
                      disabled={refreshingMissing}
                    >
                      {refreshingMissing ? 'Refreshing…' : 'Refresh missing ratings'}
                    </button>
                  )}
                  {stale && (
                    <button
                      className="px-3 py-2 text-[10px] font-mono font-semibold tracking-wide bg-[#2d2a1f] text-[#e9d7b7] border border-[#4a4434] rounded cursor-pointer hover:bg-[#363225] disabled:opacity-55 disabled:cursor-default"
                      onClick={refreshAll}
                      disabled={refreshingMissing}
                    >
                      {refreshingMissing ? 'Refreshing…' : 'Refresh data'}
                    </button>
                  )}
                  {partialData && (
                    <button
                      className="px-3 py-2 text-[10px] font-mono font-semibold tracking-wide bg-[#2d2a1f] text-[#e9d7b7] border border-[#4a4434] rounded cursor-pointer hover:bg-[#363225]"
                      onClick={() => {
                        if (!data?.imdbID) return;
                        fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`, { headers: { 'Cache-Control': 'no-cache', ...(etagRef.current ? { 'If-None-Match': etagRef.current } : {}) } })
                          .then(async r => { if (r.status === 304) return null; const body = await r.json(); const newEtag = r.headers.get('ETag'); if (newEtag) etagRef.current = newEtag; return body; })
                          .then(full => { if (full && !full.error) setData(full); });
                      }}
                    >
                      Check now
                    </button>
                  )}
                </div>
                {loadingEpisodes && <div className="text-text-muted text-sm mt-3" aria-live="polite">Loading episode ratings…</div>}
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-hidden heatmap-scroll">
              {partialData && !loadingEpisodes && (
                <div className="mb-3 px-2 py-1.5 text-[10px] font-mono tracking-wide text-[#6aa6c3] bg-[#132228] border border-[#1e3640] rounded" aria-live="polite">
                  Background IMDb enrichment running… latest ratings will appear automatically.
                </div>
              )}
              {data && data.episodes && !loadingEpisodes && <HeatMap data={data} baseMeta={baseMeta} />}
              {loadingEpisodes && <div className="text-text-muted text-sm py-4" aria-hidden="true">Preparing heatmap…</div>}
            </div>
          </div>
        )}
        {baseMeta && baseMeta.error && <p className="text-danger font-mono text-sm font-semibold mt-3" role="alert">{baseMeta.error}</p>}
        {stillLoading && !baseMeta && <div className="skeleton mt-3">Loading…</div>}
        <RecentShows onSelect={(title) => handleSearch({ title })} />
      </main>
    </div>
  )
}

export default App
