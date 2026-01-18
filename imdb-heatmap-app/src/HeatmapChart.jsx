/* eslint-disable react/prop-types */
import React, { useState, useRef, useMemo } from 'react';
import EpisodeTooltip from './EpisodeTooltip';

// Vibrant color scale
const colorScale = (rating) => {
  if (rating == null) return null;
  if (rating < 5.5) return '#ef4444';
  if (rating < 6.5) return '#f97316';
  if (rating < 7.2) return '#eab308';
  if (rating < 7.8) return '#84cc16';
  if (rating < 8.3) return '#22c55e';
  if (rating < 8.8) return '#16a34a';
  if (rating < 9.2) return '#15803d';
  return '#166534';
};

const HeatmapChart = ({ episodeDataForD3, seasons }) => {
  const [hoveredEpisode, setHoveredEpisode] = useState(null);
  const tooltipRef = useRef(null);

  // Organize episodes by season (TRANSPOSED: seasons as rows, episodes as columns)
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
      const x = e.clientX - 100;
      const y = e.clientY - 130;
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
      {/* Horizontal scroll container */}
      <div className="overflow-x-auto pb-2 heatmap-scroll border border-border rounded-lg bg-[#0d1114]">
        <div className="inline-block min-w-full p-4">

          {/* Header Row: Episode Numbers */}
          <div className="flex gap-1 mb-1">
            {/* Top-Left Corner - "Ep" label */}
            <div className="w-12 shrink-0 sticky left-0 z-20 bg-[#0d1114] text-right pr-2 text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-end justify-end pb-1">
              Ep
            </div>

            {/* Episode Number Headers */}
            {Array.from({ length: seasonData.maxEpisodes }).map((_, i) => (
              <div key={`ep-header-${i}`} className="w-10 shrink-0 text-center text-xs text-text-muted font-medium">
                {i + 1}
              </div>
            ))}

            {/* Avg Column Header */}
            <div className="w-12 shrink-0 text-center text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-end justify-center pb-1 ml-1">
              Avg
            </div>
          </div>

          {/* Data Rows: Seasons */}
          <div className="flex flex-col gap-1">
            {seasonData.seasons.map((season) => (
              <div key={season.seasonNumber} className="flex gap-1 items-center">
                {/* Season Label (Sticky Left) */}
                <div className="w-12 h-10 shrink-0 sticky left-0 z-10 bg-[#0d1114] flex items-center justify-end pr-3">
                  <span className="text-xs font-bold text-text-muted">S{season.seasonNumber}</span>
                </div>

                {/* Episodes Row */}
                {Array.from({ length: seasonData.maxEpisodes }).map((_, idx) => {
                  const episode = season.episodes.find(ep => ep.episode === idx + 1);

                  if (!episode) {
                    return (
                      <div
                        key={`empty-${season.seasonNumber}-${idx}`}
                        className="w-10 h-10 shrink-0 rounded-md bg-surface/20 border border-border/30 border-dashed"
                      />
                    );
                  }

                  const bgColor = colorScale(episode.rating);
                  const hasRating = episode.rating != null;

                  return (
                    <div
                      key={episode.id || `${season.seasonNumber}-${episode.episode}`}
                      className="w-10 h-10 shrink-0 rounded-md cursor-pointer transition-all duration-100 hover:scale-110 hover:z-20 hover:ring-2 hover:ring-white/80 shadow-sm flex items-center justify-center"
                      style={{
                        backgroundColor: bgColor || '#1e2529',
                        border: hasRating ? 'none' : '1px dashed #3a4449'
                      }}
                      onMouseEnter={() => handleMouseEnterEpisode(episode)}
                      onClick={() => episode.id && window.open(`https://www.imdb.com/title/${episode.id}`, '_blank')}
                    >
                      <span
                        className={`text-xs font-bold ${hasRating ? 'text-slate-900/80' : 'text-text-muted'
                          }`}
                      >
                        {hasRating ? episode.rating.toFixed(1) : '–'}
                      </span>
                    </div>
                  );
                })}

                {/* Season Average (Right Side) */}
                <div className="w-12 h-10 shrink-0 flex items-center justify-center text-[11px] font-mono text-text-muted font-semibold bg-surface/50 rounded ml-1">
                  {season.averageRating}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EpisodeTooltip ref={tooltipRef} episode={hoveredEpisode} />
    </div>
  );
};

export default HeatmapChart;
