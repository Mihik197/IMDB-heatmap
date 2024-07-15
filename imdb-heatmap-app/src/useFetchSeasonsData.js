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

            const fetchRatingFromIMDb = async (imdbID) => {
                try {
                    const response = await fetch(`http://localhost:5000/getRating?imdbID=${imdbID}`);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch rating for ${imdbID}`);
                    }
    
                    const { rating } = await response.json()
                    console.log(rating)
                    return parseFloat(rating) || "N/A";
                }
                catch (error) {
                    console.error("Error scraping rating data for ${imdbID}:", error);
                    return "N/A";
                }
            }

            try {
                const allSeasonsData = await Promise.all(seasonPromises);
                console.log("All seasons data", allSeasonsData);
                setSeasons(allSeasonsData);
                  

                // preparing data for D3, D3 often works best with a "flattened" data structure that's why
                const episodeDataPromises = allSeasonsData.flatMap(season => 
                    season.Episodes.map(async (episode) => {
                        const rating = parseFloat(episode.imdbRating) || await fetchRatingFromIMDb(episode.imdbID);
                        return {
                        season: parseInt(season.Season),
                        episode: parseInt(episode.Episode),
                        title: episode.Title,
                        rating: rating,
                        id: episode.imdbID
                    }
                })
                );
                
                const episodeData = await Promise.all(episodeDataPromises);
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