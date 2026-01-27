/* eslint-disable react/prop-types */
import React, { forwardRef } from 'react';
import Icon from './Icon';

const EpisodeTooltip = forwardRef(({ episode }, ref) => {
    const visibilityClass = episode ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none";

    return (
        <div
            ref={ref}
            className={`fixed z-50 pointer-events-none w-72 p-4 glass rounded-xl shadow-xl text-text transition-all duration-100 ease-out ${visibilityClass}`}
            style={{
                left: 0,
                top: 0,
                willChange: 'transform, opacity'
            }}
        >
            {episode && (
                <>
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-mono font-semibold text-text-muted bg-surface-alt px-2 py-0.5 rounded">
                            S{episode.season} E{episode.episode}
                        </span>
                        <div className="flex items-center gap-1.5 text-accent">
                            <Icon name="star" size={14} />
                            <span className="font-heading font-bold text-sm">{episode.rating?.toFixed(1) || 'N/A'}</span>
                        </div>
                    </div>
                    <h4 className="font-heading text-sm font-bold leading-tight mb-2 text-text">
                        {episode.title || 'Untitled'}
                    </h4>
                    {episode.plot && (
                        <p className="text-xs text-text-muted leading-relaxed line-clamp-3">{episode.plot}</p>
                    )}
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1.5 text-[10px] text-text-dim font-mono">
                        <Icon name="external-link" size={10} />
                        Click to open on IMDb
                    </div>
                </>
            )}
        </div>
    );
});

EpisodeTooltip.displayName = 'EpisodeTooltip';

export default EpisodeTooltip;
