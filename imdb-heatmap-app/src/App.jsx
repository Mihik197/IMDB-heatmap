import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import ShowPage from './pages/ShowPage'

/**
 * Root app component - renders header and routes.
 */
function App() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/show/:imdbId" element={<ShowPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
