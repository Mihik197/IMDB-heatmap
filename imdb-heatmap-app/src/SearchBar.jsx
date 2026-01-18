/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';

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
          className="flex-1 px-3 py-2.5 bg-surface border border-border border-r-0 text-text text-sm rounded-l font-[inherit] focus:outline focus:outline-1 focus:outline-accent"
        />
        <button
          type="submit"
          className="px-4 py-2.5 bg-accent text-[#1b1e20] font-semibold text-sm tracking-wide rounded-r border border-accent cursor-pointer hover:brightness-110 active:brightness-95"
        >
          Search
        </button>
      </form>
      {open && suggestions.length > 0 && (
        <ul
          id="search-suggestions"
          role="listbox"
          ref={listRef}
          className="absolute z-40 left-0 right-0 top-full bg-surface border border-border border-t-0 max-h-72 overflow-y-auto shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.imdbID}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex justify-between gap-2 px-2.5 py-1.5 cursor-pointer text-sm border-t border-[#202528] first:border-t-0 ${i === activeIndex ? 'bg-[#22272a]' : 'hover:bg-[#22272a]'}`}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="flex-1 text-text">{s.title}</span>
              {s.year && <span className="text-text-muted font-mono text-xs">{s.year}</span>}
              {s.type && <span className="text-text-muted text-xs">{s.type}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchBar;