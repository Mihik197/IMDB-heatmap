/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const HeatmapChart = ({ episodeDataForD3, seasons }) => {
    const svgRef = useRef(null);

    useEffect(() => {
        if (!seasons || seasons.length === 0) return;

        const cellWidth = 40;
        const cellHeight = 40;
        const margin = { top: 80, right: 20, bottom: 40, left: 60 };

        // calculate SVG height and width
        const maxEpisodesPerSeason = episodeDataForD3.reduce((maxEpisodes, episode) => {
            return Math.max(maxEpisodes, episode.episode);
        }, 0);
        const numSeasons = episodeDataForD3.reduce((maxSeason, d) => Math.max(maxSeason, d.season), 0);
        const width = numSeasons * cellWidth + margin.left + margin.right;
        const height = maxEpisodesPerSeason * cellHeight + margin.top + margin.bottom;


        // select the SVG, kinda like document.querySelector
        const svg = d3.select(svgRef.current)
                        .attr('width', width)
                        .attr('height', height);

        const xScale = d3
            .scaleBand()  // creates evenly-spaced bands for each unique value
            .domain([...new Set(episodeDataForD3.map(d => d.season))])  // unique seasons on x-axis // .domain specifies input range of the data values
            .range([0, numSeasons * cellWidth])  // output range
            .padding(0.1);  // space between bars

        const yScale = d3
            .scaleBand()
            .domain(d3.range(1, maxEpisodesPerSeason + 1))  // unique episodes
            .range([0, maxEpisodesPerSeason * cellHeight])
            .padding(0.1)

        // another alternative that can be used
        // const colorScale = d3
        //     .scaleSequential(d3.interpolateRdYlGn)
        //     .domain([5, 9.1]); // focusing the color range from 4 to 10

        const colorScale = d3.scaleLinear()
            .domain([4.5, 6, 7, 8, 9.7])  // Adjusted to match the six color stages
            .range([
                "#d73027",  // Red
                "#fc8d59",  // Soft Red
                //"#fee08b",  // Light Yellow
                "#d9ef8b",  // Light Green
                "#91cf60",  // Greenish
                "#1a9850"   // Dark Green
            ])
            .interpolate(d3.interpolateHcl); // Using HCL interpolation for better color transitions

        
        // clear any existing content
        svg.selectAll("*").remove();

        const chartGroup = svg
            .append("g")  // Creates a <g> group element in the SVG (in which we will draw the rectangles) and attaches it to the main svg variable
            .attr("transform", `translate(${margin.left}, ${margin.top})`)  // move the chart inwards

        // Create episode number labels directly (center-aligned in rows)
        chartGroup.selectAll(".episode-label")
            .data(d3.range(1, maxEpisodesPerSeason + 1)) // Data for y-axis labels 
            .enter() 
            .append("text") 
            .attr("class", d => `episode-label episode-${d}`)  // Adding a unique class for each episode label
            .text((d) => d) 
            .attr("x", -15) // Position labels half-way through margin on the left 
            .attr("y", (d) => yScale(d) + yScale.bandwidth() / 2 )  // Position in the middle of the row 
            .style("fill", "black") // Set a readable color 
            .style("font-size", "18px")  // Adjust as needed 
            .attr("dominant-baseline", "central")
            .attr("text-anchor", "middle");

        // Adding episodes axis labels
        chartGroup.append("text")
            .attr("class", "axis-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2 + margin.bottom)
            .attr("y", -margin.left + 20)
            .style("text-anchor", "middle")
            .style("font-size", "20px")  // Larger font size
            .style("font-weight", "bold")  // Bold text
            .style("fill", "#333333")
            .style("text-shadow", "1px 1px 2px rgba(255,255,255,0.7)")  // Adding shadow
            .text("Episodes");
    

        // create season labels
        chartGroup.selectAll(".season-label")
            .data(d3.range(1, numSeasons + 1))
            .enter()
            .append("text")
            .attr("class", d => `season-label season-${d}`)
            .text(d => d)
            .attr("x", (d) => xScale(d) + xScale.bandwidth() / 2) // calculate center of rect and margin on the left
            .attr("y", -10)  // Position slightly above the top of the first row of cells
            .style("fill", "black")
            .style("font-size", "18px")
            .attr("dominant-baseline", "bottom")
            .attr("text-anchor", "middle");

        // Adding seasons axis labels
        chartGroup.append("text")
            .attr("class", "axis-label")
            .attr("x", width / 2 - margin.left + 10)
            .attr("y", -40)
            .style("text-anchor", "middle")
            .style("font-size", "20px")  // Larger font size
            .style("font-weight", "bold")  // Bold text
            .style("fill", "#333333")
            .style("text-shadow", "1px 1px 2px rgba(255,255,255,0.7)")  // Adding shadow
            .text("Seasons");


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
            .style('cursor', 'pointer')  // Change cursor to pointer to indicate it's clickable
            .on("click", (event, d) => {
                // Open IMDb page for the episode in a new tab
                window.open(`https://www.imdb.com/title/${d.id}`, '_blank');
            })        
            .on("mouseover", (event, d) => {
                d3.selectAll(`.episode-label.episode-${d.episode}`)
                    .style("font-weight", "bold")
                    .style("fill", "#000")
                    .style("font-size", "22px")
                d3.selectAll(`.season-label.season-${d.season}`)
                    .style("font-weight", "bold")
                    .style("fill", "#000")
                    .style("font-size", "22px")
            })
            .on("mouseout", function(event, d) {
                // Reset label styles
                d3.selectAll(`.episode-label.episode-${d.episode}`)
                    .style("font-weight", null)
                    .style("fill", "black")
                    .style("font-size", "18px")  // Reset font size
                d3.selectAll(`.season-label.season-${d.season}`)
                    .style("font-weight", null)
                    .style("fill", "black")
                    .style("font-size", "18px")  // Reset font size
            })
            .each(function (d) {
                const rating = d.rating;

                d3.select(this.parentNode).append("text") // this here refers to the parent rectangle element
                    .text(rating !== "N/A" ? rating : "")
                    .attr("x", xScale(d.season) + xScale.bandwidth() / 2)  // centering the label
                    .attr("y", yScale(d.episode) + yScale.bandwidth() / 2 + 5)
                    .attr("text-anchor", "middle")
                    .style("fill", "white")
                    .style("pointer-events", "none");  // Ignore pointer events to ensure the rectangle captures them
            })

        //chartGroup.append('g').call(d3.axisTop(xScale));
        //chartGroup.append('g').call(d3.axisLeft(yScale));

    }, [episodeDataForD3]);

    return <svg ref={svgRef} />;
}

export default HeatmapChart;
