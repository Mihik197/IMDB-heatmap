/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react'

/**
 * Custom hook for fetching, polling, and refreshing TV show data.
 * @param {string|null} currentID - The IMDb ID of the show
 * @param {string} searchQuery - The search query (used when no ID is available)
 * @returns {object} Show data, metadata, loading states, errors, and refresh functions
 */
export function useShowData(currentID, searchQuery) {
    const [data, setData] = useState(null)
    const [baseMeta, setBaseMeta] = useState(null)
    const [loadingMeta, setLoadingMeta] = useState(false)
    const [loadingEpisodes, setLoadingEpisodes] = useState(false)
    const [refreshingMissing, setRefreshingMissing] = useState(false)
    const [error, setError] = useState(null)
    const [resolvedID, setResolvedID] = useState(currentID)
    const episodesAbortRef = useRef(null)
    const pollStopRef = useRef(false)
    const etagRef = useRef(null)

    // Reset state when search changes
    const reset = () => {
        if (episodesAbortRef.current) { episodesAbortRef.current.abort(); }
        setError(null);
        setData(null);
        setBaseMeta(null);
        setLoadingMeta(true);
        setLoadingEpisodes(false);
    }

    // Sync resolvedID with currentID prop
    useEffect(() => {
        setResolvedID(currentID);
    }, [currentID]);

    // Save to recent shows when data loads
    useEffect(() => {
        if (!data || !data.imdbID) return;
        try {
            const raw = localStorage.getItem('recentShows');
            const list = raw ? JSON.parse(raw) : [];
            const next = [
                { imdbID: data.imdbID, title: data.title || baseMeta?.Title, poster: baseMeta?.Poster, year: data.year || baseMeta?.Year },
                ...list.filter(i => i.imdbID !== data.imdbID)
            ];
            localStorage.setItem('recentShows', JSON.stringify(next));
        } catch (_) { /* ignore */ }
    }, [data?.imdbID])

    // Fetch metadata and episodes
    useEffect(() => {
        const metaController = new AbortController();

        if (resolvedID) {
            fetch(`http://localhost:5000/getShowMeta?imdbID=${resolvedID}`, { signal: metaController.signal })
                .then(r => r.json())
                .then(meta => {
                    setLoadingMeta(false);
                    if (meta && !meta.error) {
                        setBaseMeta(prev => ({ ...prev, ...meta }));
                        setLoadingEpisodes(true);
                        const epController = new AbortController();
                        episodesAbortRef.current = epController;
                        fetch(`http://localhost:5000/getShow?imdbID=${resolvedID}&trackView=1`, { signal: epController.signal })
                            .then(r => r.json())
                            .then(full => {
                                if (!epController.signal.aborted) {
                                    if (full && !full.error) setData(full);
                                    else setError(full?.error || 'Fetch failed');
                                }
                            })
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

        if (searchQuery && !resolvedID) {
            fetch(`http://localhost:5000/getShowByTitle?title=${encodeURIComponent(searchQuery)}`, { signal: metaController.signal })
                .then(r => r.json())
                .then(meta => {
                    setLoadingMeta(false);
                    setBaseMeta(meta);
                    if (meta && meta.imdbID) {
                        setResolvedID(meta.imdbID);
                    }
                })
                .catch(e => { if (e.name !== 'AbortError') { setLoadingMeta(false); setError('Fetch failed'); } });
            return () => metaController.abort();
        }
    }, [resolvedID, searchQuery])

    // Polling for partial data updates
    const partialData = data?.partialData;
    const missingRefreshInProgress = data?.missingRefreshInProgress;
    const shouldPoll = !!(partialData || data?.incomplete || missingRefreshInProgress || refreshingMissing);

    useEffect(() => {
        if (!data?.imdbID || !shouldPoll) { pollStopRef.current = true; return; }
        pollStopRef.current = false;
        let attempts = 0;
        const maxAttempts = 20;
        const intervalMs = 5000;

        const tick = () => {
            if (pollStopRef.current) return;
            attempts += 1;
            fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}&trackView=0`, {
                headers: { 'Cache-Control': 'no-cache', ...(etagRef.current ? { 'If-None-Match': etagRef.current } : {}) }
            })
                .then(async r => {
                    if (r.status === 304) return null;
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
                            const fullByKey = new Map(full.episodes.map(ep => [`${ep.season}-${ep.episode}`, ep]));
                            merged.episodes = data.episodes.map((ep) => {
                                const next = fullByKey.get(`${ep.season}-${ep.episode}`);
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
                        if (full && !full.partialData && !full.missingRefreshInProgress && !full.incomplete) {
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
    }, [partialData, data?.imdbID, data?.incomplete, missingRefreshInProgress, refreshingMissing, shouldPoll])

    // Refresh functions
    const refreshMissing = () => {
        if (!data?.imdbID) return;
        setRefreshingMissing(true);
        fetch(`http://localhost:5000/refresh/missing?imdbID=${data.imdbID}`, { method: 'POST' })
            .then(r => r.json())
            .then(() => fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}&trackView=0`))
            .then(r => r.json())
            .then(full => setData(full))
            .catch(() => {/* silent */ })
            .finally(() => setRefreshingMissing(false));
    }

    const refreshAll = () => {
        if (!data?.imdbID) return;
        setRefreshingMissing(true);
        fetch(`http://localhost:5000/refresh/show?imdbID=${data.imdbID}`, { method: 'POST' })
            .then(r => r.json())
            .then(() => fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}&trackView=0`))
            .then(r => r.json())
            .then(full => setData(full))
            .finally(() => setRefreshingMissing(false));
    }

    return {
        data,
        baseMeta,
        loadingMeta,
        loadingEpisodes,
        refreshingMissing,
        error,
        resolvedID,
        reset,
        refreshMissing,
        refreshAll,
        // Derived state
        incomplete: data?.incomplete,
        hasMissing: data?.incomplete,
        stale: (data?.metadataStale) || (data?.episodesStaleCount > 0),
        stillLoading: loadingMeta || loadingEpisodes,
        partialData: data?.partialData,
    }
}
