/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';

const SearchBar = ({ onSearch }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef(null);
  const listRef = useRef(null);
  // Track last "committed" query (selection/submission) so we don't immediately refetch suggestions
  const committedQueryRef = useRef('');
  const timeoutRef = useRef(null);

  useEffect(() => {
    // If query is committed (user selected/pressed enter) don't show suggestions until they change it
    if (query === committedQueryRef.current) return;
    if (!query || query.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      // Re-check just before firing
      if (query === committedQueryRef.current) return;
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch(`http://localhost:5000/search?q=${encodeURIComponent(query)}`, { signal: abortRef.current.signal });
        const data = await res.json();
        // Don't apply if user committed meanwhile
        if (query === committedQueryRef.current) return;
        setSuggestions(data);
        setOpen(true);
        setActiveIndex(-1);
      } catch (e) { /* ignore */ }
    }, 180);
    return () => { if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; } };
  }, [query]);

  const handleSubmit = (e) => {
    e.preventDefault();
  if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  if (abortRef.current) abortRef.current.abort();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      const sel = suggestions[activeIndex];
      committedQueryRef.current = sel.title;
      onSearch(sel);
      setQuery(sel.title); // ensure input reflects selection
    } else {
      // fallback: search by raw query (title pathway)
      committedQueryRef.current = query;
      onSearch({ title: query });
    }
    setSuggestions([]);
    setOpen(false);
  };

  const handleKey = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Enter') { /* submit handled by form */ }
  };

  const pick = (s) => {
    committedQueryRef.current = s.title;
  if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  if (abortRef.current) abortRef.current.abort();
    onSearch(s);
    setQuery(s.title);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 640 }}>
      <form onSubmit={handleSubmit} autoComplete="off">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search for a TV show"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-owns="search-suggestions"
          onFocus={() => { if (query.trim().length >= 2 && query !== committedQueryRef.current && suggestions.length) setOpen(true); }}
        />
        <button type="submit">Search</button>
      </form>
      {open && suggestions.length > 0 && (
        <ul
          id="search-suggestions"
          role="listbox"
          className="suggestions"
          ref={listRef}
        >
      {suggestions.map((s, i) => (
            <li
              key={s.imdbID}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
        <span className="title">{s.title}</span>
        {s.year && <span className="year">{s.year}</span>}
        {s.type && <span className="type">{s.type}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchBar;