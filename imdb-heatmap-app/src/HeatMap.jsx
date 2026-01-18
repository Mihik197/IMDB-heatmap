/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import useFetchSeasonsData from './useFetchSeasonsData.js';
import HeatmapChart from './HeatmapChart';
import HeatmapLegend from './HeatmapLegend';

const Heatmap = ({ data }) => {
    const { seasons, episodeDataForD3 } = useFetchSeasonsData(data);
    if (!data || !episodeDataForD3) return null;

    const totalEpisodes = episodeDataForD3.length;

    return (
        <div className="p-5 border border-border rounded-xl bg-surface shadow-sm">
            <div className="flex justify-between items-center mb-4 px-1">
                <h3 className="text-lg font-semibold text-white">Episode Ratings Heatmap</h3>
                <div className="text-sm text-text-muted">
                    Total Episodes: {totalEpisodes}
                </div>
            </div>
            <HeatmapChart episodeDataForD3={episodeDataForD3} seasons={seasons} />
            <HeatmapLegend />
        </div>
    );
};

export default Heatmap;