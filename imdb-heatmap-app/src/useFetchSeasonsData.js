/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';

const useFetchSeasonsData = (data) => {
    const [seasons, setSeasons] = useState(null);
    const [showName, setShowName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [ episodeDataForD3, setEpisodeDataForD3 ] = useState(null);

    useEffect(() => {
        async function fetchSeasonsData() {
            if (!data || !data.totalSeasons) return;  // to make sure we have the data

            setIsLoading(true);

            setShowName(data.Title);
            
            try {
                const response = await fetch(`http://localhost:5000/getShow?imdbID=${data.imdbID}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch show data');
                }

                const showData = await response.json();
                setSeasons(showData.totalSeasons);

                // preparing data for D3, D3 works best with a "flattened" data structure that's why
                const episodeData = showData.episodes.map(episode => ({
                    season: episode.season,
                    episode: episode.episode,
                    title: episode.title,
                    rating: episode.rating,
                    id: episode.imdb_id
                }));    

                console.log("Episode data for D3", episodeData);
                setEpisodeDataForD3(episodeData);

            } catch (error) {
                console.error("Error fetching seasons data :(", error);
                setError(error);
            } finally {
                setIsLoading(false);
            }
        }

        fetchSeasonsData();
    }, [data]);

    return { seasons, showName, isLoading, error, episodeDataForD3 };
}

export default useFetchSeasonsData;