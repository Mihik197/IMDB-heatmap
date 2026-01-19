/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';

const SearchBar = ({ onSearch }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const committedQueryRef = useRef('');
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (query === committedQueryRef.current) return;
    if (!query || query.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      if (query === committedQueryRef.current) return;
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      try {
        const res = await fetch(`http://localhost:5000/search?q=${encodeURIComponent(query)}`, { signal: abortRef.current.signal });
        const data = await res.json();
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
      setQuery(sel.title);
    } else {
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
    <div className="relative w-full max-w-[640px]">
      <form onSubmit={handleSubmit} autoComplete="off" className="flex">
        {/* Search Input with Icon */}
        <div className="relative flex-1">
          <Icon
            name="search"
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search for a TV show..."
            aria-autocomplete="list"
            aria-expanded={open}
            aria-owns="search-suggestions"
            onFocus={() => { if (query.trim().length >= 2 && query !== committedQueryRef.current && suggestions.length) setOpen(true); }}
            className="w-full pl-11 pr-4 py-3 bg-surface border border-border rounded-l-xl text-text text-sm font-medium transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button
          type="submit"
          className="px-5 py-3 bg-accent hover:bg-accent-bright text-bg font-heading font-semibold text-sm tracking-wide rounded-r-xl border border-accent transition-all duration-150 hover:shadow-lg hover:shadow-accent/20"
        >
          Search
        </button>
      </form>

      {/* Suggestions Dropdown */}
      {open && suggestions.length > 0 && (
        <ul
          id="search-suggestions"
          role="listbox"
          ref={listRef}
          className="absolute z-40 left-0 right-0 top-full mt-1 glass rounded-xl shadow-lg overflow-hidden animate-fade-in"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.imdbID}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer text-sm border-b border-border/50 last:border-b-0 transition-colors ${i === activeIndex ? 'bg-surface-hover' : 'hover:bg-surface-alt'
                }`}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="font-medium text-text truncate">{s.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                {s.year && (
                  <span className="text-text-muted font-mono text-xs">{s.year}</span>
                )}
                {s.type && (
                  <span className="badge badge-gold">{s.type}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchBar;