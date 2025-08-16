import React from 'react';

// Displays recently viewed shows sourced from localStorage. Non-breaking optional UI.
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
    <section className="recent-section" aria-label="Recently viewed shows">
      <h2 className="section-title">Recently Viewed</h2>
      <div className="recent-list">
        {items.map(item => (
          <button
            key={item.imdbID}
            className="recent-card"
            onClick={() => onSelect && onSelect(item.title)}
            type="button"
            aria-label={`Load ${item.title}`}
          >
            {item.poster && item.poster !== 'N/A' && (
              <img src={item.poster} alt="" loading="lazy" />
            )}
            <span className="recent-card-title">{item.title}</span>
            {item.year && <span className="recent-card-year">{item.year}</span>}
          </button>
        ))}
      </div>
    </section>
  );
};

export default RecentShows;
