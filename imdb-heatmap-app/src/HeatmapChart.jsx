/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const bins = [
  { min: 0,   max: 5.7, color: '#4b000f' },
  { min: 5.7, max: 6.7, color: '#8f1d21' },
  { min: 6.7, max: 7.4, color: '#c2481f' },
  { min: 7.4, max: 8.0, color: '#d28f18' },
  { min: 8.0, max: 8.6, color: '#3f6f32' }, // adjusted split
  { min: 8.6, max: 9.4, color: '#1f6434' }, // new
  { min: 9.4, max: 10,  color: '#0f552f' }
];
function colorFor(rating) { if (rating == null) return '#2d3336'; for (const b of bins) { if (rating >= b.min && rating < b.max) return b.color; } return bins[bins.length - 1].color; }

const HeatmapChart = ({ episodeDataForD3, seasons }) => {
  const svgRef = useRef(null);
  useEffect(() => {
    if (!seasons || seasons === 0 || !episodeDataForD3) return;
    const cellWidth = 40; // widen a bit after typography bump
    const cellHeight = 34;
    const margin = { top: 90, right: 16, bottom: 42, left: 58 };
    const maxEpisodesPerSeason = episodeDataForD3.reduce((m, e) => Math.max(m, e.episode), 0);
    const numSeasons = episodeDataForD3.reduce((m, d) => Math.max(m, d.season), 0);
    const width = numSeasons * cellWidth + margin.left + margin.right;
    const height = maxEpisodesPerSeason * cellHeight + margin.top + margin.bottom + 20;
    const seasonGroups = d3.group(episodeDataForD3.filter(d=>d.rating!=null), d => d.season);
    const seasonAverages = Array.from(seasonGroups, ([season, eps]) => ({ season, avg: d3.mean(eps, e => e.rating) })).sort((a,b)=>a.season-b.season);
    const overallAvg = d3.mean(episodeDataForD3.filter(d=>d.rating!=null), d=>d.rating);

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', 'Episode ratings heatmap with season averages and missing markers');

    const xScale = d3.scaleBand().domain([...new Set(episodeDataForD3.map(d => d.season))]).range([0, numSeasons * cellWidth]).padding(0.15);
    const yScale = d3.scaleBand().domain(d3.range(1, maxEpisodesPerSeason + 1)).range([0, maxEpisodesPerSeason * cellHeight]).padding(0.15);

    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    // hatch pattern
    defs.append('pattern').attr('id','missing-hatch').attr('patternUnits','userSpaceOnUse').attr('width',6).attr('height',6)
      .append('path').attr('d','M0,6 l6,-6 M-1,1 l2,-2 M5,7 l2,-2').attr('stroke','#5b6368').attr('stroke-width',1);

    const chartGroup = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);
    const colHighlight = chartGroup.append('rect').attr('fill','#ffffff08').attr('stroke','#ffffff12').attr('stroke-width',1).style('pointer-events','none').style('opacity',0);
    const rowHighlight = chartGroup.append('rect').attr('fill','#ffffff08').attr('stroke','#ffffff12').attr('stroke-width',1).style('pointer-events','none').style('opacity',0);

    chartGroup.selectAll('.episode-label')
      .data(d3.range(1, maxEpisodesPerSeason + 1))
      .enter().append('text')
      .attr('class', d => `episode-label episode-${d}`)
      .text(d => d)
      .attr('x', -20)
      .attr('y', d => yScale(d) + yScale.bandwidth()/2 + 1)
      .style('fill', '#6f777b')
      .style('font-size', '12px')
      .attr('dominant-baseline','middle')
      .attr('text-anchor','end');

    chartGroup.append('text')
      .attr('class','axis-label')
      .attr('transform','rotate(-90)')
      .attr('x', -(height - margin.top - margin.bottom)/2 )
      .attr('y', -margin.left + 16)
      .style('text-anchor','middle')
      .style('font-size','12px')
      .text('Episodes');

    chartGroup.selectAll('.season-label')
      .data(d3.range(1, numSeasons + 1))
      .enter().append('text')
      .attr('class', d => `season-label season-${d}`)
      .text(d => d)
      .attr('x', d => xScale(d) + xScale.bandwidth()/2)
      .attr('y', -20)
      .style('fill','#6f777b')
      .style('font-size','12px')
      .attr('text-anchor','middle');

    chartGroup.append('text')
      .attr('class','axis-label')
      .attr('x', width / 2 - margin.left + 8)
      .attr('y', -54)
      .style('text-anchor','middle')
      .style('font-size','12px')
      .text('Seasons');

    chartGroup.selectAll('.season-avg')
      .data(seasonAverages)
      .enter().append('text')
      .attr('class','season-avg')
      .text(d => d.avg.toFixed(1))
      .attr('x', d => xScale(d.season) + xScale.bandwidth()/2)
      .attr('y', -36)
      .attr('text-anchor','middle')
      .style('fill','#d0d4d6')
      .style('font-size','11px')
      .style('font-family','var(--mono)');

    chartGroup.append('text')
      .attr('class','overall-avg')
      .text(overallAvg ? `Overall ${overallAvg.toFixed(2)}` : '')
      .attr('x', width - margin.right - 10 - margin.left)
      .attr('y', -64)
      .attr('text-anchor','end')
      .style('fill','#b7bcbf')
      .style('font-size','12px')
      .style('font-family','var(--mono)');

    const tooltip = d3.select('body').append('div').attr('class','tooltip').style('opacity',0);

    const cellGroup = chartGroup.selectAll('.heatmap-cell')
      .data(episodeDataForD3)
      .enter().append('g')
      .attr('class','heatmap-cell')
      .attr('transform', d => `translate(${xScale(d.season)}, ${yScale(d.episode)})`);

    function showHighlights(d){ const cx = xScale(d.season); const cy = yScale(d.episode); colHighlight.attr('x',cx).attr('y',0).attr('width', xScale.bandwidth()).attr('height', maxEpisodesPerSeason * cellHeight).style('opacity',1); rowHighlight.attr('x',0).attr('y',cy).attr('width', numSeasons * cellWidth).attr('height', yScale.bandwidth()).style('opacity',1); }
    function hideHighlights(){ colHighlight.style('opacity',0); rowHighlight.style('opacity',0); }

    cellGroup.append('rect')
      .attr('class','heatmap-rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('role','button')
      .attr('tabindex',0)
      .attr('aria-label', d => `Season ${d.season} Episode ${d.episode}: ${d.title}${d.rating ? ` rated ${d.rating}` : ' (no rating)'}`)
      .style('fill', d => d.rating == null ? 'url(#missing-hatch)' : colorFor(d.rating))
      .style('stroke', '#171a1c')
      .style('stroke-width',1)
      .on('click', (e,d) => window.open(`https://www.imdb.com/title/${d.id}`, '_blank'))
      .on('mouseover', (event,d) => { showHighlights(d); tooltip.transition().duration(120).style('opacity',0.95); tooltip.html(`S${d.season}E${d.episode}<br/>${d.title}<br/>${d.rating ? d.rating : 'No rating'}`).style('left',(event.pageX+12)+'px').style('top',(event.pageY-28)+'px'); d3.selectAll(`.episode-label.episode-${d.episode}`).style('fill','#d0d4d6'); d3.selectAll(`.season-label.season-${d.season}`).style('fill','#d0d4d6'); })
      .on('mouseout', (event,d) => { hideHighlights(); tooltip.transition().duration(180).style('opacity',0); d3.selectAll(`.episode-label.episode-${d.episode}`).style('fill','#6f777b'); d3.selectAll(`.season-label.season-${d.season}`).style('fill','#6f777b'); })
      .on('keydown', (event,d) => { if (event.key==='Enter' || event.key===' ') window.open(`https://www.imdb.com/title/${d.id}`, '_blank'); });

    cellGroup.append('text')
      .text(d => d.rating ? d.rating : '–')
      .attr('x', xScale.bandwidth()/2)
      .attr('y', yScale.bandwidth()/2 + 5)
      .attr('text-anchor','middle')
      .style('font-size','12px')
      .style('font-family','var(--mono)')
      .style('fill','#e9ecef')
      .style('pointer-events','none');

    return () => tooltip.remove();
  }, [episodeDataForD3, seasons]);
  return <svg ref={svgRef} />;
};
export default HeatmapChart;
