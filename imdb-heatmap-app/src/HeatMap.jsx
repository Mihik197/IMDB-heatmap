/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/prop-types */
import useFetchSeasonsData from './useFetchSeasonsData.js';
import HeatmapChart from './HeatmapChart';

const Heatmap = ({ data }) => {
    const { seasons, showName, isLoading, error, episodeDataForD3 } = useFetchSeasonsData(data);
        
    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;
    if (!data) return null;

    return (
        <div>
            <h1>{showName} HeatMap (prototype)</h1>

            {/* work in progress */}

            <HeatmapChart episodeDataForD3={episodeDataForD3} seasons={seasons}/>

        </div>
    )
}

export default Heatmap;