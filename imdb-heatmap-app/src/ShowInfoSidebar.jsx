import Icon from './Icon'

/**
 * Left sidebar component displaying show metadata, poster, and action buttons.
 * @param {object} props
 * @param {object} props.baseMeta - Show metadata (Title, Poster, Year, etc.)
 * @param {object} props.data - Episode data with status flags
 * @param {function} props.onRefresh - Callback to refresh all show data
 * @param {boolean} props.isRefreshPending - Whether a refresh request is pending
 * @param {boolean} props.loadingEpisodes - Whether episodes are loading
 */
export default function ShowInfoSidebar({
    baseMeta,
    data,
    onRefresh,
    isRefreshPending,
    loadingEpisodes
}) {
    if (!baseMeta) return null;

    // Parse genres from string like "Action, Adventure, Drama"
    const genres = baseMeta.Genre ? baseMeta.Genre.split(',').map(g => g.trim()) : [];

    const incomplete = data?.incomplete;
    const hasMissing = incomplete;
    const stale = (data?.metadataStale) || (data?.episodesStaleCount > 0);
    const partialData = data?.partialData;
    const missingRefreshInProgress = data?.missingRefreshInProgress;

    return (
        <div className="w-[240px] shrink-0 card p-5">
            {/* Poster */}
            {baseMeta.Poster && baseMeta.Poster !== 'N/A' && (
                <div className="poster mb-5">
                    <img
                        src={baseMeta.Poster}
                        alt={`${baseMeta.Title} Poster`}
                        className="w-full rounded-lg"
                    />
                </div>
            )}

            {/* Title */}
            <h2 className="font-heading text-xl font-bold text-text leading-tight mb-3">
                {baseMeta.Title}
            </h2>

            {/* Rating */}
            {baseMeta.imdbRating && baseMeta.imdbRating !== 'N/A' && (
                <div className="flex items-center gap-2 mb-4 bg-surface-alt rounded-full px-3 py-2 w-fit">
                    <Icon name="star" size={18} className="text-accent" />
                    <span className="font-heading font-bold text-text">{baseMeta.imdbRating}</span>
                    <span className="text-text-muted text-sm">/ 10</span>
                </div>
            )}

            {/* Year & Seasons */}
            <div className="flex items-center gap-3 text-sm text-text-muted mb-4 flex-wrap">
                {baseMeta.Year && (
                    <div className="flex items-center gap-1.5">
                        <Icon name="calendar" size={14} className="text-text-dim" />
                        <span>{baseMeta.Year}</span>
                    </div>
                )}
                {baseMeta.totalSeasons && (
                    <div className="flex items-center gap-1.5">
                        <Icon name="seasons" size={14} className="text-text-dim" />
                        <span>{baseMeta.totalSeasons} Season{baseMeta.totalSeasons !== '1' ? 's' : ''}</span>
                    </div>
                )}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {genres.map(genre => (
                        <span
                            key={genre}
                            className="px-2.5 py-1 text-[11px] font-medium text-text-muted bg-surface-alt border border-border rounded-full"
                        >
                            {genre}
                        </span>
                    ))}
                </div>
            )}

            {/* Plot */}
            {baseMeta.Plot && baseMeta.Plot !== 'N/A' && (
                <p className="text-sm text-text-muted leading-relaxed mb-4">{baseMeta.Plot}</p>
            )}

            {/* Status badge - unified indicator for data state */}
            {(() => {
                // Unified condition: any background work happening
                const isEnriching = partialData || missingRefreshInProgress || isRefreshPending;

                // Show enrichment badge with priority (takes precedence over incomplete)
                if (isEnriching) {
                    return (
                        <div className="mb-4">
                            <span className="badge badge-blue animate-pulse" title="Fetching episode ratings from IMDb - they'll appear automatically">
                                <Icon name="refresh" size={10} className="animate-spin" />
                                Loading ratings…
                            </span>
                        </div>
                    );
                }

                // Show incomplete warning only when NOT actively enriching
                // This means ratings couldn't be found and likely won't appear
                if (incomplete) {
                    return (
                        <div className="mb-4">
                            <span className="badge badge-gold" title="Some episode ratings are unavailable on IMDb">
                                <Icon name="warning" size={10} />
                                Some ratings unavailable
                            </span>
                        </div>
                    );
                }

                return null;
            })()}

            {/* Refresh button - adaptive label based on state */}
            <div className="flex flex-col gap-2">
                <button
                    className="btn btn-secondary flex items-center justify-center gap-2 w-full text-xs"
                    onClick={onRefresh}
                    disabled={isRefreshPending}
                >
                    <Icon name="refresh" size={14} className={isRefreshPending ? 'animate-spin' : ''} />
                    {isRefreshPending
                        ? 'Refreshing…'
                        : hasMissing
                            ? 'Refresh missing ratings'
                            : stale
                                ? 'Refresh stale data'
                                : 'Refresh data'}
                </button>
            </div>

            {loadingEpisodes && (
                <div className="flex items-center gap-2 text-text-muted text-sm mt-4" aria-live="polite">
                    <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Loading ratings…
                </div>
            )}
        </div>
    )
}
