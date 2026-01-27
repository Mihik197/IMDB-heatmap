import SearchBar from '../components/SearchBar'
import DiscoverSection from '../components/DiscoverSection'
import RecentShows from '../components/RecentShows'

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
