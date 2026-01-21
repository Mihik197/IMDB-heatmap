import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icon from './Icon';
import ShowCard from './ShowCard';

// Number of items to show initially and load on each scroll
const INITIAL_ITEMS = 8;
const LOAD_MORE_ITEMS = 6;

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

export default ShowRow;
