import SearchBar from '../SearchBar'
import DiscoverSection from '../DiscoverSection'
import RecentShows from '../RecentShows'

/**
 * Home page - landing experience with search and discovery sections.
 */
export default function HomePage() {
    return (
        <>
            <SearchBar />
            <DiscoverSection />
            <RecentShows />
        </>
    )
}
