import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icon from './Icon';

// Cache TTL values (in milliseconds)
const CACHE_TTL = {
    trending: 24 * 60 * 60 * 1000,  // 24 hours
    featured: 7 * 24 * 60 * 60 * 1000, // 7 days
    popular: 6 * 60 * 60 * 1000, // 6 hours
};

// Number of items to show initially and load on each scroll
const INITIAL_ITEMS = 8;
const LOAD_MORE_ITEMS = 6;

// Helper to get cached data from localStorage
const getCachedData = (key) => {
    try {
        const raw = localStorage.getItem(`discover_${key}`);
        if (!raw) return null;
        const { data, timestamp } = JSON.parse(raw);
        const ttl = CACHE_TTL[key] || CACHE_TTL.trending;
        if (Date.now() - timestamp < ttl) {
            return data;
        }
        // Cache expired, remove it
        localStorage.removeItem(`discover_${key}`);
    } catch (e) {
        console.warn(`[DiscoverSection] cache read error for ${key}:`, e);
    }
    return null;
};

// Helper to cache data to localStorage
const setCachedData = (key, data) => {
    try {
        localStorage.setItem(`discover_${key}`, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn(`[DiscoverSection] cache write error for ${key}:`, e);
    }
};

// Helper to extract just the start year for consistent display
const formatYear = (yearStr) => {
    if (!yearStr) return '';
    const match = String(yearStr).match(/^(\d{4})/);
    return match ? match[1] : yearStr;
};

const ShowCard = ({ show, onSelect }) => {
    const hasRating = show.imdbRating && show.imdbRating !== 'N/A';
    const displayYear = formatYear(show.year);

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
        </button>
    );
};

const ShowRow = ({ title, icon, shows, onSelect, loading }) => {
    const scrollRef = useRef(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [visibleCount, setVisibleCount] = useState(INITIAL_ITEMS);

    // Memoize the visible shows to avoid re-renders
    const visibleShows = useMemo(() => shows.slice(0, visibleCount), [shows, visibleCount]);
    const hasMore = visibleCount < shows.length;

    const updateScrollButtons = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setCanScrollLeft(scrollLeft > 5);
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 5);
    }, []);

    // Check if more items should be loaded when scrolling near the end
    const checkLoadMore = useCallback(() => {
        if (!scrollRef.current || !hasMore) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        // Load more when within 400px of the right edge
        if (scrollLeft + clientWidth >= scrollWidth - 400) {
            setVisibleCount(prev => Math.min(prev + LOAD_MORE_ITEMS, shows.length));
        }
    }, [hasMore, shows.length]);

    useEffect(() => {
        updateScrollButtons();
        const el = scrollRef.current;
        if (el) {
            const handleScroll = () => {
                updateScrollButtons();
                checkLoadMore();
            };
            el.addEventListener('scroll', handleScroll, { passive: true });
            window.addEventListener('resize', updateScrollButtons);
            const timer = setTimeout(updateScrollButtons, 100);
            return () => {
                el.removeEventListener('scroll', handleScroll);
                window.removeEventListener('resize', updateScrollButtons);
                clearTimeout(timer);
            };
        }
    }, [shows, updateScrollButtons, checkLoadMore, visibleCount]);

    // Reset visible count when shows change
    useEffect(() => {
        setVisibleCount(INITIAL_ITEMS);
    }, [shows]);

    const scroll = (direction) => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;
        const cardWidth = 172;
        const visibleCards = Math.floor(container.clientWidth / cardWidth);
        const scrollAmount = Math.max(cardWidth * Math.max(visibleCards - 1, 2), 400);
        const amount = direction === 'left' ? -scrollAmount : scrollAmount;
        container.scrollBy({ left: amount, behavior: 'smooth' });
    };

    if (!loading && shows.length === 0) return null;

    return (
        <section className="mb-10 animate-fade-in" aria-label={title}>
            <div className="flex items-center gap-2 mb-4">
                <Icon name={icon} size={18} className="text-accent" />
                <h2 className="text-sm font-heading font-bold tracking-wide text-text uppercase">
                    {title}
                </h2>
            </div>

            <div className="relative group/row">
                {/* Left scroll button */}
                <button
                    onClick={() => scroll('left')}
                    className={`absolute -left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center transition-all duration-200 shadow-lg hover:bg-surface-hover hover:border-accent ${canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
                        }`}
                    aria-label="Scroll left"
                    disabled={!canScrollLeft}
                >
                    <Icon name="chevron-left" size={20} className="text-text" />
                </button>

                {/* Right scroll button */}
                <button
                    onClick={() => scroll('right')}
                    className={`absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center transition-all duration-200 shadow-lg hover:bg-surface-hover hover:border-accent ${canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
                        }`}
                    aria-label="Scroll right"
                    disabled={!canScrollRight}
                >
                    <Icon name="chevron-right" size={20} className="text-text" />
                </button>

                {/* Fade edges */}
                {canScrollLeft && (
                    <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-bg to-transparent z-10 pointer-events-none" />
                )}
                {canScrollRight && (
                    <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-bg to-transparent z-10 pointer-events-none" />
                )}

                {/* Scrollable container */}
                <div
                    ref={scrollRef}
                    className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide scroll-smooth"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {loading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="discover-card-skeleton">
                                <div className="discover-card-poster-skeleton skeleton" />
                                <div className="p-2.5">
                                    <div className="skeleton h-4 w-28 mb-1" />
                                </div>
                            </div>
                        ))
                    ) : (
                        <>
                            {visibleShows.map((show) => (
                                <ShowCard key={show.imdbID} show={show} onSelect={onSelect} />
                            ))}
                            {/* Loading indicator for more items */}
                            {hasMore && (
                                <div className="discover-card-skeleton flex-shrink-0 flex items-center justify-center opacity-50">
                                    <div className="text-xs text-text-muted font-mono">
                                        +{shows.length - visibleCount}
                                    </div>
                                </div>
                            )}
                        </>
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
        // Try loading from localStorage cache first
        const cachedTrending = getCachedData('trending');
        const cachedFeatured = getCachedData('featured');
        const cachedPopular = getCachedData('popular');

        // Trending shows
        if (cachedTrending) {
            setTrending(cachedTrending);
            setLoading(prev => ({ ...prev, trending: false }));
        } else {
            fetch('http://localhost:5000/trending')
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setTrending(data);
                        setCachedData('trending', data);
                    }
                    setLoading(prev => ({ ...prev, trending: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, trending: false })));
        }

        // Featured shows
        if (cachedFeatured) {
            setFeatured(cachedFeatured);
            setLoading(prev => ({ ...prev, featured: false }));
        } else {
            fetch('http://localhost:5000/featured')
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setFeatured(data);
                        setCachedData('featured', data);
                    }
                    setLoading(prev => ({ ...prev, featured: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, featured: false })));
        }

        // Popular shows (shorter cache since it changes more often)
        if (cachedPopular) {
            setPopular(cachedPopular);
            setLoading(prev => ({ ...prev, popular: false }));
        } else {
            fetch('http://localhost:5000/popular')
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setPopular(data);
                        setCachedData('popular', data);
                    }
                    setLoading(prev => ({ ...prev, popular: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, popular: false })));
        }
    }, []);

    const allDone = !loading.trending && !loading.popular && !loading.featured;
    const hasAnyContent = trending.length > 0 || popular.length > 0 || featured.length > 0;

    if (allDone && !hasAnyContent) return null;

    return (
        <div className="mt-8">
            {/* Featured shows first (curated) */}
            <ShowRow
                title="Featured Shows"
                icon="star"
                shows={featured}
                onSelect={onSelect}
                loading={loading.featured}
            />

            {/* Trending on IMDB */}
            <ShowRow
                title="Trending on IMDB"
                icon="fire"
                shows={trending}
                onSelect={onSelect}
                loading={loading.trending}
            />

            {/* Popular on this app */}
            <ShowRow
                title="Popular on HeatMap"
                icon="chart"
                shows={popular}
                onSelect={onSelect}
                loading={loading.popular}
            />
        </div>
    );
};

export default DiscoverSection;
