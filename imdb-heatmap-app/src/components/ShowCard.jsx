import React from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';

// Helper to extract just the start year for consistent display
const formatYear = (yearStr) => {
    if (!yearStr) return '';
    const match = String(yearStr).match(/^(\d{4})/);
    return match ? match[1] : yearStr;
};

const ShowCard = React.memo(({ show }) => {
    const hasRating = show.imdbRating && show.imdbRating !== 'N/A';
    const displayYear = formatYear(show.year);

    return (
        <Link
            to={`/show/${show.imdbID}`}
            className="discover-card group"
            aria-label={`View heatmap for ${show.title}`}
        >
            {show.poster && show.poster !== 'N/A' ? (
                <div className="discover-card-poster">
                    <img
                        src={show.poster}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                        <div className="flex items-center justify-between">
                            {displayYear && (
                                <span className="text-[11px] text-white/80 font-mono">{displayYear}</span>
                            )}
                            {hasRating && (
                                <span className="flex items-center gap-1 text-[11px] text-accent font-mono font-semibold">
                                    <Icon name="star" size={10} className="text-accent" />
                                    {Number(show.imdbRating).toFixed(1)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="discover-card-poster bg-surface-alt flex items-center justify-center">
                    <Icon name="film" size={28} className="text-text-dim" />
                </div>
            )}
            <div className="p-2.5">
                <span className="block font-heading font-semibold text-[13px] leading-snug text-text line-clamp-2">
                    {show.title}
                </span>
            </div>
        </Link>
    );
});

export default ShowCard;
