import { useParams, Link } from 'react-router-dom'
import { useShowData } from '../useShowData'
import HeatMap from '../HeatMap'
import ShowInfoSidebar from '../ShowInfoSidebar'
import ErrorAlert from '../ErrorAlert'
import RecentShows from '../RecentShows'
import Icon from '../Icon'

/**
 * Show page - displays heatmap for a specific TV show.
 * Reads imdbId from URL params.
 */
export default function ShowPage() {
    const { imdbId } = useParams()

    const {
        data,
        baseMeta,
        loadingEpisodes,
        isRefreshPending,
        error,
        refreshAll,
        stillLoading,
    } = useShowData(imdbId)

    return (
        <>
            {/* Back to home link */}
            <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-4"
            >
                <Icon name="chevron-left" size={16} />
                <span>Back to discover</span>
            </Link>

            <ErrorAlert message={error} />

            {baseMeta && !baseMeta.error && (
                <div className="flex gap-6 items-start animate-fade-in">
                    {/* Left Sidebar - Show Info (contains unified status indicator) */}
                    <ShowInfoSidebar
                        baseMeta={baseMeta}
                        data={data}
                        onRefresh={refreshAll}
                        isRefreshPending={isRefreshPending}
                        loadingEpisodes={loadingEpisodes}
                    />

                    {/* Right Content - Heatmap */}
                    <div className="flex-1 min-w-0">
                        {data && data.episodes && !loadingEpisodes && <HeatMap data={data} baseMeta={baseMeta} />}
                        {loadingEpisodes && (
                            <div className="flex items-center gap-3 text-text-muted py-8">
                                <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                                <span className="font-medium">Preparing heatmap…</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <ErrorAlert message={baseMeta?.error} />

            {stillLoading && !baseMeta && <div className="skeleton mt-4">Loading…</div>}

            {/* Recent shows for easy navigation to other shows */}
            {baseMeta && !baseMeta.error && (
                <div className="mt-8">
                    <RecentShows />
                </div>
            )}
        </>
    )
}
