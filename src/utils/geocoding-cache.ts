import { getEnv } from "./get-env";
import NodeGeocoder from "node-geocoder";

// Geocoding cache interface
interface GeocodingCacheEntry {
    result: any;
    timestamp: number;
    ttl: number;
}

// In-memory cache for geocoding results
class GeocodingCache {
    private cache = new Map<string, GeocodingCacheEntry>();
    private maxSize = 1000; // Maximum number of cached entries
    private defaultTTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    set(key: string, result: any, ttl: number = this.defaultTTL): void {
        // Remove oldest entries if cache is full
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, {
            result,
            timestamp: Date.now(),
            ttl
        });
    }

    get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if entry has expired
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.result;
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

const geocodingCache = new GeocodingCache();

// Function to geocode with caching and fallback
export async function geocodeWithCache(query: string): Promise<any> {
    // Check cache first
    const cacheKey = query.toLowerCase().trim();
    const cachedResult = geocodingCache.get(cacheKey);

    if (cachedResult) {
        return cachedResult;
    }

    try {
        const GOOGLE_API_KEY = getEnv("GOOGLE_API_KEY");
        const googleGeocoder = NodeGeocoder({
            provider: "google",
            apiKey: GOOGLE_API_KEY,
        });

        const googleResult = await googleGeocoder.geocode(query);

        if (googleResult && googleResult.length > 0) {
            geocodingCache.set(cacheKey, googleResult);
            return googleResult;
        }
    } catch (googleError) {
        console.error(`Google geocoding failed for "${query}":`, googleError);
        throw new Error(`Geocoding failed for "${query}"`);
    }

    throw new Error(`No geocoding results found for "${query}"`);
}