/* eslint-disable react/prop-types */
import React, { forwardRef } from 'react';

const EpisodeTooltip = forwardRef(({ episode }, ref) => {
    const visibilityClass = episode ? "opacity-100" : "opacity-0 pointer-events-none";

    return (
        <div
            ref={ref}
            className={`fixed z-50 pointer-events-none w-64 p-3 bg-[#0f1518] border border-border rounded-lg shadow-xl text-text transition-opacity duration-75 ease-out ${visibilityClass}`}
            style={{
                left: 0,
                top: 0,
                willChange: 'transform'
            }}
        >
            {episode && (
                <>
                    <div className="flex justify-between items-start mb-1">
                        <span className="text-xs font-semibold text-text-muted">S{episode.season} E{episode.episode}</span>
                        <div className="flex items-center text-yellow-400">
                            <svg className="w-3 h-3 mr-1 fill-current" viewBox="0 0 20 20">
                                <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                            </svg>
                            <span className="font-bold text-sm">{episode.rating?.toFixed(1) || 'N/A'}</span>
                        </div>
                    </div>
                    <h4 className="text-sm font-bold leading-tight mb-1 text-white">{episode.title || 'Untitled'}</h4>
                    {episode.plot && <p className="text-xs text-text-muted line-clamp-2">{episode.plot}</p>}
                </>
            )}
        </div>
    );
});

EpisodeTooltip.displayName = 'EpisodeTooltip';

export default EpisodeTooltip;
