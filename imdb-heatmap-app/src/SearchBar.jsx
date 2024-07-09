/* eslint-disable react/prop-types */
import { useState } from "react";

const SearchBar = ({ onSearch }) => {
    const [ query, setQuery ] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSearch(query);
    }

    return (
        <form onSubmit={handleSubmit}>
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a TV show"
            />
            <button type="submit">Search</button>
        </form>
    )
}

export default SearchBar;