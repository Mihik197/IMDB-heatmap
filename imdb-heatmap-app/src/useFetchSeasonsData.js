/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';

const useFetchSeasonsData = (data) => {
    const [seasons, setSeasons] = useState(null);
    const [showName, setShowName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [ episodeDataForD3, setEpisodeDataForD3 ] = useState(null);

    const apiKey = import.meta.env.VITE_API_KEY;

    useEffect(() => {
        async function fetchSeasonsData() {
            if (!data || !data.totalSeasons) return;  // to make sure we have the data

            setIsLoading(true);

            setShowName(data.Title);
            const totalSeasons = parseInt(data.totalSeasons);
            const seasonPromises = [];

            for (let i = 1; i <= totalSeasons; i++) {
                seasonPromises.push(
                    fetch(`http://www.omdbapi.com/?apikey=${apiKey}&i=${data.imdbID}&season=${i}`)
                        .then(response => response.json())
                        .catch(error => {
                            console.error(`Error fetching season ${i} data`, error);
                            setError(error);
                            return { Episodes: [] };  // to keep the data structure consistent in case one season's data is missing in between
                        })
                );
            }

            try {
                const allSeasonsData = await Promise.all(seasonPromises);
                console.log("All seasons data", allSeasonsData);
                setSeasons(allSeasonsData);

                // preparing data for D3, D3 often works best with a "flattened" data structure that's why
                const episodeData = allSeasonsData.flatMap(season => 
                    season.Episodes.map(episode => ({
                        season: parseInt(season.Season),
                        episode: parseInt(episode.Episode),
                        title: episode.Title,
                        rating: parseFloat(episode.imdbRating),
                        id: episode.imdbID
                    }))
                );

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