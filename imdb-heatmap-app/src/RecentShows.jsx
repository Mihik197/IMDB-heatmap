import { Link } from 'react-router-dom';
import Icon from './Icon';

const RecentShows = () => {
  let items = [];
  try {
    const raw = localStorage.getItem('recentShows');
    if (raw) items = JSON.parse(raw);
  } catch (e) {
    // Fail silently; keep empty list.
  }
  if (!items.length) return null;

  return (
    <section className="mt-8" aria-label="Recently viewed shows">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="clock" size={14} className="text-text-dim" />
        <h2 className="text-xs font-mono font-bold tracking-widest text-text-muted uppercase">
          Recently Viewed
        </h2>
      </div>
      <div className="flex flex-wrap gap-3">
        {items.map(item => (
          <Link
            key={item.imdbID}
            to={`/show/${item.imdbID}`}
            className="card card-glow p-2.5 w-[150px] text-left transition-all duration-200 hover:-translate-y-1 group"
            aria-label={`Load ${item.title}`}
          >
            {item.poster && item.poster !== 'N/A' && (
              <div className="relative mb-2 rounded-lg overflow-hidden">
                <img
                  src={item.poster}
                  alt=""
                  loading="lazy"
                  className="w-full h-[140px] object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="flex items-center gap-1 text-[10px] text-white/90 font-mono">
                    <Icon name="play" size={10} />
                    <span>View heatmap</span>
                  </div>
                </div>
              </div>
            )}
            <span className="block font-heading font-semibold text-xs leading-tight text-text truncate">
              {item.title}
            </span>
            {item.year && (
              <span className="block font-mono text-[10px] text-text-muted mt-0.5">{item.year}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
};

export default RecentShows;
