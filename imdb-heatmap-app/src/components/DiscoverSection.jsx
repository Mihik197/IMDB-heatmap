import { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';
import ShowRow from './ShowRow';

// Cache TTL values (in milliseconds)
const CACHE_TTL = {
    trending: 24 * 60 * 60 * 1000,  // 24 hours
    featured: 7 * 24 * 60 * 60 * 1000, // 7 days
    popular: 6 * 60 * 60 * 1000, // 6 hours
};

// Helper to get cached data from localStorage
const getCachedData = (key) => {
    try {
        const raw = localStorage.getItem(`discover_${key}`);
        if (!raw) return null;
        const { data, timestamp } = JSON.parse(raw);
        const ttl = CACHE_TTL[key] || CACHE_TTL.trending;
        if (Date.now() - timestamp < ttl) {
            return data;
        }
        // Cache expired, remove it
        localStorage.removeItem(`discover_${key}`);
    } catch (e) {
        console.warn(`[DiscoverSection] cache read error for ${key}:`, e);
    }
    return null;
};

// Helper to cache data to localStorage
const setCachedData = (key, data) => {
    try {
        localStorage.setItem(`discover_${key}`, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn(`[DiscoverSection] cache write error for ${key}:`, e);
    }
};

const DiscoverSection = () => {
    const [trending, setTrending] = useState([]);
    const [popular, setPopular] = useState([]);
    const [featured, setFeatured] = useState([]);
    const [loading, setLoading] = useState({ trending: true, popular: true, featured: true });

    useEffect(() => {
        // Try loading from localStorage cache first
        const cachedTrending = getCachedData('trending');
        const cachedFeatured = getCachedData('featured');
        const cachedPopular = getCachedData('popular');

        // Trending shows
        if (cachedTrending) {
            setTrending(cachedTrending);
            setLoading(prev => ({ ...prev, trending: false }));
        } else {
            fetch(apiUrl('/trending'))
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setTrending(data);
                        setCachedData('trending', data);
                    }
                    setLoading(prev => ({ ...prev, trending: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, trending: false })));
        }

        // Featured shows
        if (cachedFeatured) {
            setFeatured(cachedFeatured);
            setLoading(prev => ({ ...prev, featured: false }));
        } else {
            fetch(apiUrl('/featured'))
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setFeatured(data);
                        setCachedData('featured', data);
                    }
                    setLoading(prev => ({ ...prev, featured: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, featured: false })));
        }

        // Popular shows (shorter cache since it changes more often)
        if (cachedPopular) {
            setPopular(cachedPopular);
            setLoading(prev => ({ ...prev, popular: false }));
        } else {
            fetch(apiUrl('/popular'))
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setPopular(data);
                        setCachedData('popular', data);
                    }
                    setLoading(prev => ({ ...prev, popular: false }));
                })
                .catch(() => setLoading(prev => ({ ...prev, popular: false })));
        }
    }, []);

    const allDone = !loading.trending && !loading.popular && !loading.featured;
    const hasAnyContent = trending.length > 0 || popular.length > 0 || featured.length > 0;

    if (allDone && !hasAnyContent) return null;

    return (
        <div className="mt-8">
            {/* Featured shows first (curated) */}
            <ShowRow
                title="Featured Shows"
                icon="star"
                shows={featured}
                loading={loading.featured}
            />

            {/* Trending on IMDB */}
            <ShowRow
                title="Trending on IMDB"
                icon="fire"
                shows={trending}
                loading={loading.trending}
            />

            {/* Popular on this app */}
            <ShowRow
                title="Popular on HeatMap"
                icon="chart"
                shows={popular}
                loading={loading.popular}
            />
        </div>
    );
};

export default DiscoverSection;
