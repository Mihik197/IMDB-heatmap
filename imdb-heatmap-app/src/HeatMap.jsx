/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import * as d3 from 'd3';

const Heatmap = ({ data }) => {
    const [ seasons, setSeasons ] = useState(null);  // this will get the data for all seasons i.e. episode ratings and stuff
    const [ showName, setShowName ] = useState('');
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState(null)
    const [ episodeDataForD3, setEpisodeDataForD3 ] = useState(null);

    const svgRef = useRef(null);

    useEffect(() => {
        const fetchSeasonsData = async() => {
            if (!data || !data.totalSeasons) return;  // to make sure we have the data

            setIsLoading(true);

            setShowName(data.Title);
            const totalSeasons = parseInt(data.totalSeasons)
            const seasonPromises = [];

            for (let i = 1; i <= totalSeasons; i++ ) {
                seasonPromises.push(
                    fetch(`htt://www.omdbapi.com/?apikey=your_api_key&i=${data.imdbID}&season=${i}`) //p removed
                        .then(response => response.json())
                        .catch(error => {
                            console.error(`Error fetching season ${i} data`, error);
                            setError(error);
                            return { Episodes: [] };  // to keep the data structure consistend incase one season's data is missing in between
                        })
                )
            }

            try {
                const allSeasonsData = await Promise.all(seasonPromises);
                console.log("All seasons data", allSeasonsData);
                setSeasons(allSeasonsData);

                // preparing data for D3, D3 often works best with a "flattened" data structure that's why
                const episodeData = allSeasonsData.flatMap((season, seasonIndex) => 
                    season.Episodes.map((episode, episodeIndex) => ({
                        season: parseInt(season.Season),
                        episode: episodeIndex + 1,
                        title: episode.Title,
                        rating: parseFloat(episode.imdbRating),
                        id: episode.imdbID,
                    }))
                );

                setEpisodeDataForD3(episodeData);
            }
            catch (error) {
                console.error("Error fetching seasons data :(", error);
                setError(error);
            }
            finally {
                setIsLoading(false);
            }
        };


        fetchSeasonsData();
    }, [data])

    

    useEffect(() => {
        if (!seasons || seasons.length === 0) return;

        const totalEpisodes = 

        // select the SVG, kinda like document.querySelector
        const svg = d3.select(svgRef.current);
        const margin = { top: 20, right: 20, bottom: 30, left: 40 };
        const width = 600 - margin.left - margin.right;
        const height = 400 - margin.top - margin.bottom;

        const xScale = d3
            .scaleBand()  // creates evenly-spaced bands for each unique value
            .domain([...new Set(episodeDataForD3.map((d) => d.season))])  // unique seasons on x-axis // .domain specifies input range of the data values
            .range([0, width])  // output range
            .padding(0.1);  // space between bars

        const yScale = d3
            .scaleBand()
            .domain([...new Set(episodeDataForD3.map((d) => d.episode))])  // unique episodes
            .range([height, 0])
            .padding(0.1)

        const colorScale = d3
            .scaleSequential(d3.interpolateRdYlGn)
            .domain([1, 10]); // maps ratings to colors along the "red-yellow-green" color scheme

        // clear any existing content
        svg.selectAll("*").remove();

        const chartGroup = svg
            .append("g")  // Creates a <g> group element in the SVG (in which we will draw the rectangles) and attaches it to the main svg variable
            .attr("transform", `translate(${margin.left}, ${margin.top})`)  // move the chart inwards

        // finally rendering the rectangles
        chartGroup.selectAll('.heatmap-rect')
            .data(episodeDataForD3)
            .enter()
            .append('rect')
            .attr('class', 'heatmap-rect')  // class for styling
            .attr('x', d => xScale(d.season))
            .attr('y', d => yScale(d.episode))
            .attr('width', xScale.bandwidth())
            .attr('height', yScale.bandwidth())
            .style('fill', d => colorScale(d.rating))
            .each(function (d) {
                const rating = d.rating;

                d3.select(this.parentNode).append("text") // this here refers to the parent rectangle element
                    .text(rating !== "N/A" ? rating : "")
                    .attr("x", xScale(d.season) + xScale.bandwidth() / 2)  // centering the label
                    .attr("y", yScale(d.episode) + yScale.bandwidth() / 2 + 5)
                    .attr("text-anchor", "middle")
                    .style("fill", "white");

            })

        const xAxis = chartGroup.append('g')
            .attr('transform', `translate(0, ${height})`)
            .call(d3.axisBottom(xScale));

        chartGroup.append('g').call(d3.axisLeft(yScale));

    }, [episodeDataForD3])

    if (!data) {
        return null;
    }

    if (isLoading) {
        return (
            <div>Loading HeatMap...</div>
        )
    }

    if (error) {
        return (
            <div>Error: {error}</div>
        )
    }

    return (
        <div>
            <h1>{showName} HeatMap (prototype)</h1>

            {/* work in progress */}

            {seasons !== null &&  
                <svg ref={svgRef} width={600} height={400} />
            }

            
            {/*<pre>{JSON.stringify(seasons, null, 2)}</pre>   null, 2 parameters handle the formatting to make it more readable, <pre/> tag to preserve whitespace and line breaks */}
        </div>
    )
}

export default Heatmap;