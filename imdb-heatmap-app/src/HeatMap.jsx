/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import useFetchSeasonsData from './useFetchSeasonsData.js';
import HeatmapChart from './HeatmapChart';
import HeatmapLegend from './HeatmapLegend';
import Icon from './Icon';

const Heatmap = ({ data }) => {
    const { seasons, episodeDataForD3 } = useFetchSeasonsData(data);
    if (!data || !episodeDataForD3) return null;

    const totalEpisodes = episodeDataForD3.length;

    return (
        <div className="card p-6">
            <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-3">
                    <Icon name="grid" size={20} className="text-accent" />
                    <h3 className="font-heading text-lg font-semibold text-text">Episode Ratings Heatmap</h3>
                </div>
                <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Icon name="episodes" size={16} className="text-text-dim" />
                    <span className="font-mono">{totalEpisodes}</span>
                    <span>episodes</span>
                </div>
            </div>
            <HeatmapChart episodeDataForD3={episodeDataForD3} seasons={seasons} />
            <HeatmapLegend />
        </div>
    );
};

export default Heatmap;