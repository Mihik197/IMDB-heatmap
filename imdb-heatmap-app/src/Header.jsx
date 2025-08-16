import React from 'react';

// Simple header with placeholder branding; non-breaking addition.
const Header = () => {
  return (
    <header className="app-header" role="banner">
      <div className="brand">
        <div className="wordmark">IMDB HEATMAP</div>
        <div className="titles">
          <h1 className="app-title">Episode Ratings by Season</h1>
          <p className="app-tagline">Ratings distribution visualized</p>
        </div>
      </div>
    </header>
  );
};

export default Header;
