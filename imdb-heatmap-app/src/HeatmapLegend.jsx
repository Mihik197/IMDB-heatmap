/* eslint-disable react/prop-types */
import React from 'react';

const HeatmapLegend = () => {
  const legendColors = [
    { color: '#4b000f', label: '< 5.7' },
    { color: '#8f1d21', label: '5.7 – <6.7' },
    { color: '#c2481f', label: '6.7 – <7.4' },
    { color: '#d28f18', label: '7.4 – <8.0' },
    { color: '#3f6f32', label: '8.0 – <8.6' }, // adjusted
    { color: '#1f6434', label: '8.6 – <9.4' }, // new shade
    { color: '#0f552f', label: '≥ 9.4' }
  ];

  return (
    <div className="legend-container" aria-label="Rating color legend">
      {legendColors.map((item) => (
        <div key={item.label} className="legend-item">
          <div className="legend-color" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
      <div className="legend-item missing">
        <div className="legend-swatch" />
        <div className="legend-label">No rating</div>
      </div>
    </div>
  );
};

export default HeatmapLegend;
