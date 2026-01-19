import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';

const ShowCard = ({ show, onSelect }) => {
    const hasRating = show.imdbRating && show.imdbRating !== 'N/A';

    return (
        <button
            className="discover-card group"
            onClick={() => onSelect && onSelect({ imdbID: show.imdbID, title: show.title })}
            type="button"
            aria-label={`View heatmap for ${show.title}`}
        >
            {show.poster && show.poster !== 'N/A' ? (
                <div className="discover-card-poster">
                    <img
                        src={show.poster}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="flex items-center gap-1 text-[10px] text-white/90 font-mono">
                            <Icon name="chart" size={10} />
                            <span>View heatmap</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="discover-card-poster bg-surface-alt flex items-center justify-center">
                    <Icon name="film" size={24} className="text-text-dim" />
                </div>
            )}
            <div className="p-2">
                <span className="block font-heading font-semibold text-xs leading-tight text-text truncate">
                    {show.title}
                </span>
                <div className="flex items-center gap-2 mt-1">
                    {show.year && (
                        <span className="text-[10px] text-text-muted font-mono">{show.year}</span>
                    )}
                    {hasRating && (
                        <span className="flex items-center gap-0.5 text-[10px] text-accent font-mono">
                            <Icon name="star" size={9} />
                            {show.imdbRating}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
};

const ShowRow = ({ title, icon, shows, onSelect, loading }) => {
    const scrollRef = useRef(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollButtons = () => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setCanScrollLeft(scrollLeft > 0);
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    };

    useEffect(() => {
        updateScrollButtons();
        const el = scrollRef.current;
        if (el) {
            el.addEventListener('scroll', updateScrollButtons);
            window.addEventListener('resize', updateScrollButtons);
            return () => {
                el.removeEventListener('scroll', updateScrollButtons);
                window.removeEventListener('resize', updateScrollButtons);
            };
        }
    }, [shows]);

    const scroll = (direction) => {
        if (!scrollRef.current) return;
        const amount = direction === 'left' ? -300 : 300;
        scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    };

    if (!loading && shows.length === 0) return null;

    return (
        <section className="mb-8 animate-fade-in" aria-label={title}>
            <div className="flex items-center gap-2 mb-4">
                <Icon name={icon} size={16} className="text-accent" />
                <h2 className="text-sm font-heading font-bold tracking-wide text-text uppercase">
                    {title}
                </h2>
            </div>

            <div className="relative group/row">
                {/* Scroll buttons */}
                {canScrollLeft && (
                    <button
                        onClick={() => scroll('left')}
                        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-surface/90 border border-border flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-surface-hover"
                        aria-label="Scroll left"
                    >
                        <Icon name="chevron-left" size={16} className="text-text" />
                    </button>
                )}
                {canScrollRight && (
                    <button
                        onClick={() => scroll('right')}
                        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-surface/90 border border-border flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-surface-hover"
                        aria-label="Scroll right"
                    >
                        <Icon name="chevron-right" size={16} className="text-text" />
                    </button>
                )}

                {/* Scrollable container */}
                <div
                    ref={scrollRef}
                    className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {loading ? (
                        // Loading skeletons
                        Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="discover-card-skeleton">
                                <div className="discover-card-poster-skeleton skeleton" />
                                <div className="p-2">
                                    <div className="skeleton h-3 w-24 mb-1" />
                                    <div className="skeleton h-2 w-16" />
                                </div>
                            </div>
                        ))
                    ) : (
                        shows.map((show) => (
                            <ShowCard key={show.imdbID} show={show} onSelect={onSelect} />
                        ))
                    )}
                </div>
            </div>
        </section>
    );
};

const DiscoverSection = ({ onSelect }) => {
    const [trending, setTrending] = useState([]);
    const [popular, setPopular] = useState([]);
    const [featured, setFeatured] = useState([]);
    const [loading, setLoading] = useState({ trending: true, popular: true, featured: true });

    useEffect(() => {
        // Fetch trending shows
        fetch('http://localhost:5000/trending')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setTrending(data);
                setLoading(prev => ({ ...prev, trending: false }));
            })
            .catch(() => setLoading(prev => ({ ...prev, trending: false })));

        // Fetch popular shows (most viewed on this app)
        fetch('http://localhost:5000/popular')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setPopular(data);
                setLoading(prev => ({ ...prev, popular: false }));
            })
            .catch(() => setLoading(prev => ({ ...prev, popular: false })));

        // Fetch featured shows (curated list)
        fetch('http://localhost:5000/featured')
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setFeatured(data);
                setLoading(prev => ({ ...prev, featured: false }));
            })
            .catch(() => setLoading(prev => ({ ...prev, featured: false })));
    }, []);

    const allDone = !loading.trending && !loading.popular && !loading.featured;
    const hasAnyContent = trending.length > 0 || popular.length > 0 || featured.length > 0;

    // If everything loaded and there's nothing to show, return null
    if (allDone && !hasAnyContent) return null;

    return (
        <div className="mt-8">
            {/* Trending on IMDB */}
            <ShowRow
                title="Trending on IMDB"
                icon="fire"
                shows={trending}
                onSelect={onSelect}
                loading={loading.trending}
            />

            {/* Popular on this app (only show if there's data) */}
            <ShowRow
                title="Popular on HeatMap"
                icon="chart"
                shows={popular}
                onSelect={onSelect}
                loading={loading.popular}
            />

            {/* Featured shows (curated) - always show as fallback */}
            <ShowRow
                title="Featured Shows"
                icon="star"
                shows={featured}
                onSelect={onSelect}
                loading={loading.featured}
            />
        </div>
    );
};

export default DiscoverSection;
