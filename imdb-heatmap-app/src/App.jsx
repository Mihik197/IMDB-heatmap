/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react'
import './App.css'
import SearchBar from './SearchBar'
import HeatMap from './HeatMap'

function App() {
  const [ searchQuery, setSearchQuery ] = useState('')
  const [ data, setData ] = useState(null)

  const apiKey = import.meta.env.VITE_API_KEY;

  const handleSearch = (query) => {
    setSearchQuery(query)
  }

  useEffect(() => {
    const fetchAPI = async() => {
      fetch(`http://www.omdbapi.com/?apikey=${apiKey}&t=${searchQuery}`)  // removed p so that it doesn't send requests now while in dev to save API requests
      .then(response => response.json())
      .then(data => {
        console.log(data);
        setData(data);
      })
      .catch(error => console.error("API error:", error));
    };

    fetchAPI();
  }, [searchQuery])

  return (
    
    <div>
      <SearchBar
        onSearch={handleSearch}
      />
      {data === null ? null : (
        <div>
          <h2>{data.Title}</h2>
          <p>{data.Year}</p>
          <p>{data.Plot}</p>
          {/* Render other properties as needed */}
          <HeatMap data={data} />
        </div>
      )}
    </div>

  )
}

export default App
