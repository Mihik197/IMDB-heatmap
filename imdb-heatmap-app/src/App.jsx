import { useState } from 'react'
import SearchBar from './SearchBar'
import HeatMap from './HeatMap'
import Header from './Header'
import RecentShows from './RecentShows'
import DiscoverSection from './DiscoverSection'
import Icon from './Icon'
import ErrorAlert from './ErrorAlert'
import ShowInfoSidebar from './ShowInfoSidebar'
import { useShowData } from './useShowData'

function App() {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentID, setCurrentID] = useState(null)

  const {
    data,
    baseMeta,
    loadingEpisodes,
    refreshingMissing,
    error,
    reset,
    refreshMissing,
    refreshAll,
    stillLoading,
    partialData,
  } = useShowData(currentID, searchQuery)

  const handleSearch = (item) => {
    if (!item) return;
    reset();
    if (item.imdbID) {
      setCurrentID(item.imdbID);
      setSearchQuery(item.title || '');
    } else {
      setCurrentID(null);
      setSearchQuery(item.title);
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <SearchBar onSearch={handleSearch} />

        <ErrorAlert message={error} />

        {baseMeta && !baseMeta.error && (
          <div className="mt-6 flex gap-6 items-start animate-fade-in">
            {/* Left Sidebar - Show Info */}
            <ShowInfoSidebar
              baseMeta={baseMeta}
              data={data}
              onRefreshMissing={refreshMissing}
              onRefreshAll={refreshAll}
              refreshingMissing={refreshingMissing}
              loadingEpisodes={loadingEpisodes}
            />

            {/* Right Content - Heatmap */}
            <div className="flex-1 min-w-0">
              {partialData && !loadingEpisodes && (
                <div className="mb-4 px-4 py-3 flex items-center gap-2 text-sm text-info bg-blue-900/20 border border-blue-800/40 rounded-lg" aria-live="polite">
                  <Icon name="info" size={16} className="shrink-0" />
                  Background IMDb enrichment running… latest ratings will appear automatically.
                </div>
              )}
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

        {/* Show discover sections when no show is selected */}
        {!baseMeta && !stillLoading && (
          <>
            <DiscoverSection onSelect={(item) => handleSearch(item)} />
            <RecentShows onSelect={(title) => handleSearch({ title })} />
          </>
        )}

        {/* Show recent shows below heatmap when viewing a show */}
        {baseMeta && !baseMeta.error && (
          <div className="mt-8">
            <RecentShows onSelect={(title) => handleSearch({ title })} />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
