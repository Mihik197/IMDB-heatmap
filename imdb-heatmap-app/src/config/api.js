/**
 * API Configuration
 * Centralized configuration for API base URL and endpoints
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Helper function to build API URLs
 * @param {string} endpoint - The API endpoint (e.g., '/search', '/getShow')
 * @param {Object} params - Optional query parameters
 * @returns {string} The full API URL
 */
export function apiUrl(endpoint, params = {}) {
    const url = new URL(endpoint, API_BASE_URL);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.append(key, value);
        }
    });
    return url.toString();
}
