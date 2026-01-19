/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react'
import SearchBar from './SearchBar'
import HeatMap from './HeatMap'
import Header from './Header'
import RecentShows from './RecentShows'
import Icon from './Icon'

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
            // Merge with existing baseMeta to preserve fields like imdbRating that may not be in getShowMeta
            setBaseMeta(prev => ({ ...prev, ...meta }));
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
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <SearchBar onSearch={handleSearch} />

        {error && (
          <div className="flex items-center gap-2 mt-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg" role="alert">
            <Icon name="warning" size={16} className="text-danger shrink-0" />
            <p className="text-danger font-medium text-sm">{error}</p>
          </div>
        )}

        {baseMeta && !baseMeta.error && (
          <div className="mt-6 flex gap-6 items-start animate-fade-in">
            {/* Left Sidebar - Show Info */}
            <div className="w-[240px] shrink-0 card p-5">
              {/* Poster */}
              {baseMeta.Poster && baseMeta.Poster !== 'N/A' && (
                <div className="poster mb-5">
                  <img
                    src={baseMeta.Poster}
                    alt={`${baseMeta.Title} Poster`}
                    className="w-full rounded-lg"
                  />
                </div>
              )}

              {/* Title */}
              <h2 className="font-heading text-xl font-bold text-text leading-tight mb-3">{baseMeta.Title}</h2>

              {/* Rating */}
              {baseMeta.imdbRating && baseMeta.imdbRating !== 'N/A' && (
                <div className="flex items-center gap-2 mb-4 bg-surface-alt rounded-full px-3 py-2 w-fit">
                  <Icon name="star" size={18} className="text-accent" />
                  <span className="font-heading font-bold text-text">{baseMeta.imdbRating}</span>
                  <span className="text-text-muted text-sm">/ 10</span>
                </div>
              )}

              {/* Year & Seasons */}
              <div className="flex items-center gap-3 text-sm text-text-muted mb-4 flex-wrap">
                {baseMeta.Year && (
                  <div className="flex items-center gap-1.5">
                    <Icon name="calendar" size={14} className="text-text-dim" />
                    <span>{baseMeta.Year}</span>
                  </div>
                )}
                {baseMeta.totalSeasons && (
                  <div className="flex items-center gap-1.5">
                    <Icon name="seasons" size={14} className="text-text-dim" />
                    <span>{baseMeta.totalSeasons} Season{baseMeta.totalSeasons !== '1' ? 's' : ''}</span>
                  </div>
                )}
              </div>

              {/* Genres */}
              {genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {genres.map(genre => (
                    <span
                      key={genre}
                      className="px-2.5 py-1 text-[11px] font-medium text-text-muted bg-surface-alt border border-border rounded-full"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
              )}

              {/* Plot */}
              {baseMeta.Plot && baseMeta.Plot !== 'N/A' && (
                <p className="text-sm text-text-muted leading-relaxed mb-4">{baseMeta.Plot}</p>
              )}

              {/* Status badges */}
              <div className="flex flex-wrap gap-2 mb-4">
                {incomplete && (
                  <span className="badge badge-gold" title="Some episodes still missing ratings">
                    <Icon name="warning" size={10} />
                    Incomplete
                  </span>
                )}
                {partialData && (
                  <span className="badge badge-blue animate-pulse" title="Background enrichment in progress">
                    <Icon name="refresh" size={10} className="animate-spin" />
                    Enriching…
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {hasMissing && (
                  <button
                    className="btn btn-secondary flex items-center justify-center gap-2 w-full text-xs"
                    onClick={refreshMissing}
                    disabled={refreshingMissing}
                  >
                    <Icon name="refresh" size={14} className={refreshingMissing ? 'animate-spin' : ''} />
                    {refreshingMissing ? 'Refreshing…' : 'Refresh missing'}
                  </button>
                )}
                {stale && (
                  <button
                    className="btn btn-secondary flex items-center justify-center gap-2 w-full text-xs"
                    onClick={refreshAll}
                    disabled={refreshingMissing}
                  >
                    <Icon name="refresh" size={14} className={refreshingMissing ? 'animate-spin' : ''} />
                    {refreshingMissing ? 'Refreshing…' : 'Refresh data'}
                  </button>
                )}
              </div>

              {loadingEpisodes && (
                <div className="flex items-center gap-2 text-text-muted text-sm mt-4" aria-live="polite">
                  <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  Loading ratings…
                </div>
              )}
            </div>

            {/* Right Content - Heatmap */}
            <div className="flex-1 min-w-0">
              {partialData && !loadingEpisodes && (
                <div className="mb-4 px-4 py-3 flex items-center gap-2 text-sm text-info bg-blue-900/20 border border-blue-800/40 rounded-lg" aria-live="polite">
                  <Icon name="info" size={16} className="shrink-0" />
                  Background IMDb enrichment running… latest ratings will appear automatically.
                </div>
              )}
              {data && data.episodes && !loadingEpisodes && <HeatMap data={data} baseMeta={baseMeta} />}
              {loadingEpisodes && (
                <div className="flex items-center gap-3 text-text-muted py-8">
                  <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="font-medium">Preparing heatmap…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {baseMeta && baseMeta.error && (
          <div className="flex items-center gap-2 mt-4 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg" role="alert">
            <Icon name="warning" size={16} className="text-danger shrink-0" />
            <p className="text-danger font-medium text-sm">{baseMeta.error}</p>
          </div>
        )}

        {stillLoading && !baseMeta && <div className="skeleton mt-4">Loading…</div>}

        <RecentShows onSelect={(title) => handleSearch({ title })} />
      </main>
    </div>
  )
}

export default App
