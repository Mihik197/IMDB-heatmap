/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import useFetchSeasonsData from './useFetchSeasonsData.js';
import HeatmapChart from './HeatmapChart';
import HeatmapLegend from './HeatmapLegend';

const Heatmap = ({ data }) => {
    const { seasons, episodeDataForD3 } = useFetchSeasonsData(data);
    if (!data || !episodeDataForD3) return null;
    return (
        <div className="heatmap-wrapper">
            <HeatmapLegend />
            <HeatmapChart episodeDataForD3={episodeDataForD3} seasons={seasons} />
        </div>
    );
};

export default Heatmap;