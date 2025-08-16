/* eslint-disable react-hooks/exhaustive-deps */
// Simplified hook: derive seasons + flattened episode list directly from parent-supplied data.
// Eliminates redundant network fetch that caused UI flashing and double loading states.
import { useMemo } from 'react';

const useFetchSeasonsData = (data) => {
    const derived = useMemo(() => {
        if (!data || !data.episodes) return { seasons: null, showName: '', episodeDataForD3: null };
        const episodeDataForD3 = data.episodes.map(ep => ({
            season: ep.season,
            episode: ep.episode,
            title: ep.title,
            rating: ep.rating,
            id: ep.imdb_id
        }));
        return {
            seasons: data.totalSeasons,
            showName: data.title || '',
            episodeDataForD3
        };
    }, [data]);
    return { ...derived, isLoading: false, error: null };
};

export default useFetchSeasonsData;