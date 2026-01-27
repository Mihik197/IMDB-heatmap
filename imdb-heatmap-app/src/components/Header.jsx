import { Link } from 'react-router-dom';
import Icon from './Icon';

const Header = () => {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg-alt/95 backdrop-blur-md" role="banner">
      <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center gap-8">
        {/* Logo / Branding - clickable to go home */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent-muted flex items-center justify-center shadow-md">
            <Icon name="grid" size={18} className="text-bg" />
          </div>
          <div>
            <div className="font-display text-lg font-bold tracking-wide text-accent">
              IMDB HEATMAP
            </div>
            <p className="text-[11px] text-text-muted font-mono -mt-0.5">
              Episode ratings visualized
            </p>
          </div>
        </Link>

        {/* Tagline */}
        <div className="hidden sm:block pl-6 border-l border-border">
          <h1 className="font-heading text-base font-semibold text-text">
            Episode Ratings by Season
          </h1>
        </div>
      </div>
    </header>
  );
};

export default Header;
