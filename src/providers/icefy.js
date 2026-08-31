// src/providers/icefy.js
// Icefy Provider - Fetches HLS streams from streams.icefy.top
// Part of AuraMovies local scrapers collection

const { BaseProvider } = require('@omss/framework');

// ============================================
//  IcefyProvider Class
// ============================================

class IcefyProvider extends BaseProvider {
    constructor() {
        super();
        this.id = 'Icefy';
        this.name = 'Icefy';
        this.enabled = true;
        this.BASE_URL = 'https://streams.icefy.top';
        this.HEADERS = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': this.BASE_URL,
            'Origin': this.BASE_URL
        };
    }

    // -----------------------------------------------------------------
    // OMSS Required Methods
    // -----------------------------------------------------------------

    async getMovieSources(media) {
        return this.getSources(media);
    }

    async getTVSources(media) {
        return this.getSources(media);
    }

    // -----------------------------------------------------------------
    // Core Logic
    // -----------------------------------------------------------------

    async getSources(media) {
        try {
            const apiUrl = this.buildApiUrl(media);
            const response = await fetch(apiUrl, { headers: this.HEADERS });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const data = await response.json();

            if (!data?.stream) {
                throw new Error('No stream URL returned');
            }

            return {
                sources: [
                    {
                        url: data.stream,
                        quality: '1080',
                        type: 'hls',
                        audioTracks: [
                            {
                                label: 'English',
                                language: 'eng'
                            }
                        ],
                        provider: {
                            name: this.name,
                            id: this.id
                        }
                    }
                ],
                subtitles: [],
                diagnostics: []
            };
        } catch (error) {
            return {
                sources: [],
                subtitles: [],
                diagnostics: [
                    {
                        code: 'PROVIDER_ERROR',
                        message: `${this.name}: ${error.message}`,
                        field: '',
                        severity: 'error'
                    }
                ]
            };
        }
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    buildApiUrl(media) {
        if (media.type === 'movie') {
            return `${this.BASE_URL}/movie/${media.tmdbId}`;
        }
        if (media.type === 'tv') {
            if (!media.s || !media.e) {
                throw new Error('Missing season or episode');
            }
            return `${this.BASE_URL}/tv/${media.tmdbId}/${media.s}/${media.e}`;
        }
        throw new Error('Unsupported media type');
    }

    async healthCheck() {
        try {
            const res = await fetch(this.BASE_URL, { method: 'HEAD', headers: this.HEADERS });
            return res.status === 200;
        } catch {
            return false;
        }
    }
}

// ============================================
//  Exported Function for server.js
// ============================================

/**
 * Main entry point for server.js to fetch streams.
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} seasonNum - Season number (tv only)
 * @param {number} episodeNum - Episode number (tv only)
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Icefy] Searching for ${mediaType} ${tmdbId}`);

    try {
        const provider = new IcefyProvider();
        const media = {
            tmdbId: String(tmdbId),
            type: mediaType,
            s: seasonNum,
            e: episodeNum
        };

        const result = await provider.getSources(media);

        if (result.sources && result.sources.length > 0) {
            return result.sources.map((s) => ({
                name: 'Icefy',
                title: 'Icefy Stream',
                url: s.url,
                quality: s.quality || '1080p',
                provider: 'icefy',
                headers: {
                    'User-Agent': provider.HEADERS['User-Agent'],
                    'Referer': provider.BASE_URL + '/',
                    'Origin': provider.BASE_URL
                },
                isHLS: s.url.includes('.m3u8'),
                isMP4: s.url.includes('.mp4'),
                audioTracks: s.audioTracks || []
            }));
        }

        console.log('[Icefy] No streams found');
        return [];
    } catch (error) {
        console.error('[Icefy] Error:', error.message);
        return [];
    }
}

module.exports = { getStreams, scrape: getStreams };