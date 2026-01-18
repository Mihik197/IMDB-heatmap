/* eslint-disable react/prop-types */
import React, { useState, useRef, useMemo } from 'react';
import EpisodeTooltip from './EpisodeTooltip';

// Vibrant color scale matching reference images
const colorScale = (rating) => {
  if (rating == null) return null;
  if (rating < 5.5) return '#ef4444';  // red-500
  if (rating < 6.5) return '#f97316';  // orange-500
  if (rating < 7.2) return '#eab308';  // yellow-500
  if (rating < 7.8) return '#84cc16';  // lime-500
  if (rating < 8.3) return '#22c55e';  // green-500
  if (rating < 8.8) return '#16a34a';  // green-600
  if (rating < 9.2) return '#15803d';  // green-700
  return '#166534';                     // green-800
};

const HeatmapChart = ({ episodeDataForD3, seasons }) => {
  const [hoveredEpisode, setHoveredEpisode] = useState(null);
  const tooltipRef = useRef(null);

  // Organize episodes by season
  const seasonData = useMemo(() => {
    if (!episodeDataForD3 || !seasons) return { seasons: [], maxEpisodes: 0 };

    const seasonMap = {};
    let maxEps = 0;

    episodeDataForD3.forEach(ep => {
      if (!seasonMap[ep.season]) {
        seasonMap[ep.season] = [];
      }
      seasonMap[ep.season].push(ep);
      maxEps = Math.max(maxEps, ep.episode);
    });

    Object.values(seasonMap).forEach(eps => {
      eps.sort((a, b) => a.episode - b.episode);
    });

    const seasonsArray = Object.keys(seasonMap)
      .map(Number)
      .sort((a, b) => a - b)
      .map(seasonNum => {
        const episodes = seasonMap[seasonNum];
        const ratedEpisodes = episodes.filter(ep => ep.rating != null);
        const avg = ratedEpisodes.length > 0
          ? ratedEpisodes.reduce((sum, ep) => sum + ep.rating, 0) / ratedEpisodes.length
          : null;
        return {
          seasonNumber: seasonNum,
          episodes,
          averageRating: avg?.toFixed(1) || '–'
        };
      });

    return { seasons: seasonsArray, maxEpisodes: maxEps };
  }, [episodeDataForD3, seasons]);

  const handleMouseMove = (e) => {
    if (tooltipRef.current) {
      const x = e.clientX + 15;
      const y = e.clientY - 100;
      tooltipRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  };

  const handleMouseEnterEpisode = (episode) => {
    setHoveredEpisode(episode);
  };

  const handleMouseLeave = () => {
    setHoveredEpisode(null);
  };

  if (!seasonData.seasons.length) return null;

  return (
    <div
      className="w-full relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Horizontal scroll container only */}
      <div className="overflow-x-auto heatmap-scroll border border-border rounded-lg bg-[#0d1114]">
        <table className="border-collapse">
          <thead>
            <tr>
              {/* EP corner header */}
              <th className="sticky left-0 bg-[#0d1114] px-2 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider text-center min-w-[44px]">
                EP
              </th>
              {/* Season headers */}
              {seasonData.seasons.map((season) => (
                <th
                  key={`header-${season.seasonNumber}`}
                  className="px-0.5 py-1.5 text-xs font-bold text-text-muted whitespace-nowrap text-center min-w-[44px]"
                >
                  S{season.seasonNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Episode rows */}
            {Array.from({ length: seasonData.maxEpisodes }).map((_, rowIdx) => (
              <tr key={`row-${rowIdx}`}>
                {/* Episode number - sticky left */}
                <td className="sticky left-0 bg-[#0d1114] px-2 py-0.5 text-xs text-text-muted font-medium text-center">
                  {rowIdx + 1}
                </td>
                {/* Episode cells for each season */}
                {seasonData.seasons.map((season) => {
                  const episode = season.episodes.find(ep => ep.episode === rowIdx + 1);

                  if (!episode) {
                    return (
                      <td key={`empty-${season.seasonNumber}-${rowIdx}`} className="p-0.5">
                        <div className="h-10 w-10 rounded-md bg-surface/20 border border-border/30 border-dashed" />
                      </td>
                    );
                  }

                  const bgColor = colorScale(episode.rating);
                  const hasRating = episode.rating != null;

                  return (
                    <td key={episode.id || `${season.seasonNumber}-${episode.episode}`} className="p-0.5">
                      <div
                        className="h-10 w-10 rounded-md cursor-pointer transition-all duration-100 hover:scale-110 hover:z-50 hover:ring-2 hover:ring-white/80 shadow-sm flex items-center justify-center"
                        style={{
                          backgroundColor: bgColor || '#1e2529',
                          border: hasRating ? 'none' : '1px dashed #3a4449'
                        }}
                        onMouseEnter={() => handleMouseEnterEpisode(episode)}
                        onClick={() => episode.id && window.open(`https://www.imdb.com/title/${episode.id}`, '_blank')}
                      >
                        <span
                          className={`text-xs font-bold ${hasRating
                            ? 'text-slate-900/80'
                            : 'text-text-muted'
                            }`}
                        >
                          {hasRating ? episode.rating.toFixed(1) : '–'}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Season averages row */}
            <tr>
              <td className="sticky left-0 bg-[#0d1114] px-2 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider text-center">
                AVG
              </td>
              {seasonData.seasons.map((season) => (
                <td
                  key={`avg-${season.seasonNumber}`}
                  className="px-0.5 py-1.5 text-xs font-mono text-text-muted font-semibold text-center"
                >
                  {season.averageRating}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <EpisodeTooltip ref={tooltipRef} episode={hoveredEpisode} />
    </div>
  );
};

export default HeatmapChart;
