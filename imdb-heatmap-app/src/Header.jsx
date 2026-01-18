import React from 'react';

const Header = () => {
  return (
    <header className="sticky top-0 z-50 flex items-end gap-8 px-7 py-4 border-b border-border bg-[#14181a]" role="banner">
      <div className="flex items-baseline gap-5">
        <div className="font-mono text-sm font-semibold tracking-[2px] text-accent">IMDB HEATMAP</div>
        <div>
          <h1 className="text-base font-semibold tracking-wide text-text">Episode Ratings by Season</h1>
          <p className="text-[11px] text-text-muted font-mono tracking-wide">Ratings distribution visualized</p>
        </div>
      </div>
    </header>
  );
};

export default Header;
