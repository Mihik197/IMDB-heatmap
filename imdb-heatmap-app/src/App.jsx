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

  // Parse genres from string like "Action, Adventure, Drama"
  const genres = baseMeta?.Genre ? baseMeta.Genre.split(',').map(g => g.trim()) : [];

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header />
      <main className="max-w-[1400px] mx-auto px-4 py-4">
        <SearchBar onSearch={handleSearch} />
        {error && <p className="text-danger font-mono text-sm font-semibold mt-3" role="alert">{error}</p>}

        {baseMeta && !baseMeta.error && (
          <div className="mt-4 flex gap-4 items-start">
            {/* Left Sidebar - Show Info */}
            <div className="w-[220px] shrink-0 bg-surface border border-border rounded-lg p-4">
              {/* Poster */}
              {baseMeta.Poster && baseMeta.Poster !== 'N/A' && (
                <img
                  src={baseMeta.Poster}
                  alt={`${baseMeta.Title} Poster`}
                  className="w-full rounded-lg mb-4 shadow-md"
                />
              )}

              {/* Title */}
              <h2 className="text-lg font-bold text-white leading-tight mb-2">{baseMeta.Title}</h2>

              {/* Rating */}
              {baseMeta.imdbRating && baseMeta.imdbRating !== 'N/A' && (
                <div className="flex items-center gap-1.5 mb-3 bg-[#1a1f23] rounded-full px-3 py-1.5 w-fit">
                  <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                  </svg>
                  <span className="text-white font-bold">{baseMeta.imdbRating}</span>
                  <span className="text-text-muted text-sm">/ 10</span>
                </div>
              )}

              {/* Year & Seasons */}
              <div className="flex items-center gap-2 text-xs text-text-muted mb-3 flex-wrap">
                {baseMeta.Year && (
                  <div className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>{baseMeta.Year}</span>
                  </div>
                )}
                {baseMeta.totalSeasons && (
                  <div className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span>{baseMeta.totalSeasons} Season{baseMeta.totalSeasons !== '1' ? 's' : ''}</span>
                  </div>
                )}
              </div>

              {/* Genres */}
              {genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {genres.map(genre => (
                    <span
                      key={genre}
                      className="px-2 py-0.5 text-[10px] font-medium text-text-muted bg-surface-alt border border-border rounded-full"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {/* Plot */}
              {baseMeta.Plot && baseMeta.Plot !== 'N/A' && (
                <p className="text-xs text-text-muted leading-relaxed mb-3">{baseMeta.Plot}</p>
              )}

              {/* Status badges */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {incomplete && (
                  <span className="inline-block px-2 py-0.5 text-[9px] font-mono font-semibold tracking-wide bg-[#302414] text-[#d9a45e] border border-[#4a3722] rounded" title="Some episodes still missing ratings">
                    Incomplete
                  </span>
                )}
                {partialData && (
                  <span className="inline-block px-2 py-0.5 text-[9px] font-mono font-semibold tracking-wide bg-[#1e2d38] text-[#7fb9d8] border border-[#2d4856] rounded" title="Background enrichment in progress">
                    Enriching…
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-1.5">
                {hasMissing && (
                  <button
                    className="w-full px-2 py-1.5 text-[9px] font-mono font-semibold tracking-wide bg-[#253035] text-text border border-[#354247] rounded cursor-pointer hover:bg-[#2d3a40] disabled:opacity-55 disabled:cursor-default"
                    onClick={refreshMissing}
                    disabled={refreshingMissing}
                  >
                    {refreshingMissing ? 'Refreshing…' : 'Refresh missing'}
                  </button>
                )}
                {stale && (
                  <button
                    className="w-full px-2 py-1.5 text-[9px] font-mono font-semibold tracking-wide bg-[#2d2a1f] text-[#e9d7b7] border border-[#4a4434] rounded cursor-pointer hover:bg-[#363225] disabled:opacity-55 disabled:cursor-default"
                    onClick={refreshAll}
                    disabled={refreshingMissing}
                  >
                    {refreshingMissing ? 'Refreshing…' : 'Refresh data'}
                  </button>
                )}
              </div>

              {loadingEpisodes && <div className="text-text-muted text-xs mt-3" aria-live="polite">Loading ratings…</div>}
            </div>

            {/* Right Content - Heatmap */}
            <div className="flex-1 min-w-0">
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
