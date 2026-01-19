/* eslint-disable react/prop-types */
import React from 'react';

const HeatmapLegend = () => {
  // Original color scale to match HeatmapChart
  const legendColors = [
    { color: '#ef4444', label: '< 5.5' },
    { color: '#f97316', label: '5.5–6.5' },
    { color: '#eab308', label: '6.5–7.2' },
    { color: '#84cc16', label: '7.2–7.8' },
    { color: '#22c55e', label: '7.8–8.3' },
    { color: '#16a34a', label: '8.3–8.8' },
    { color: '#15803d', label: '8.8–9.2' },
    { color: '#166534', label: '≥ 9.2' }
  ];

  return (
    <div className="flex flex-wrap gap-2 items-center mt-4" aria-label="Rating color legend">
      <span className="text-xs font-mono text-text-muted mr-1">Rating:</span>
      {legendColors.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div
            className="w-4 h-4 rounded shadow-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[10px] font-mono text-text-muted">{item.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 ml-2">
        <div
          className="w-4 h-4 rounded border border-dashed border-text-muted/50 bg-surface/30"
        />
        <span className="text-[10px] font-mono text-text-muted">No rating</span>
      </div>
    </div>
  );
};

export default HeatmapLegend;
