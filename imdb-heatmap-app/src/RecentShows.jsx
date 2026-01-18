import React from 'react';

const RecentShows = ({ onSelect }) => {
  let items = [];
  try {
    const raw = localStorage.getItem('recentShows');
    if (raw) items = JSON.parse(raw);
  } catch (e) {
    // Fail silently; keep empty list.
  }
  if (!items.length) return null;
  return (
    <section className="mt-2" aria-label="Recently viewed shows">
      <h2 className="text-[10px] font-mono font-semibold tracking-widest text-text-muted mb-2 uppercase">Recently Viewed</h2>
      <div className="flex flex-wrap gap-2 pb-1">
        {items.map(item => (
          <button
            key={item.imdbID}
            className="bg-surface-alt border border-border text-text p-2 rounded flex flex-col gap-1 w-[140px] cursor-pointer text-left transition-colors hover:bg-[#252b2e]"
            onClick={() => onSelect && onSelect(item.title)}
            type="button"
            aria-label={`Load ${item.title}`}
          >
            {item.poster && item.poster !== 'N/A' && (
              <img src={item.poster} alt="" loading="lazy" className="w-full h-[135px] object-cover rounded" />
            )}
            <span className="font-semibold text-[11px] leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</span>
            {item.year && <span className="font-mono text-[10px] text-text-muted">{item.year}</span>}
          </button>
        ))}
      </div>
    </section>
  );
};

export default RecentShows;
