// src/providers/dahmermovies.js
// DahmerMovies Provider - Extracts direct video links from a.111477.xyz
// Supports movies and TV series with episode filtering and quality sorting
// Part of AuraMovies local scrapers collection

const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');

// ============================================
// Configuration
// ============================================

const DAHMER_MOVIES_API = 'https://a.111477.xyz';

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': `${DAHMER_MOVIES_API}/`
};

// ============================================
// Helper Functions
// ============================================

/**
 * Parse HTML table rows to extract file links with metadata
 * @param {string} html - HTML content of the directory listing
 * @returns {Array} Array of link objects { text, href, size }
 */
function parseLinks(html) {
    const links = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
        const rowContent = match[1];
        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        const sizeMatch = rowContent.match(/<td[^>]*>(\d+(?:\.\d+)?\s?[KMGT]B)<\/td>/i);

        if (linkMatch) {
            const href = linkMatch[1];
            const text = linkMatch[2].trim();
            const size = sizeMatch ? sizeMatch[1].trim() : 'N/A';

            if (text && href !== '../' && /\.(mkv|mp4|avi|webm|m3u8)$/i.test(text)) {
                links.push({ text, href, size });
            }
        }
    }

    return links;
}

/**
 * Fetch directory listing for a movie or TV series
 * @param {string} title - Title of the media
 * @param {string} year - Release year (for movies)
 * @param {number|null} season - Season number (for TV series)
 * @returns {Promise<Object|null>} Object with html and dirUrl, or null if not found
 */
async function fetchDirectory(title, year, season) {
    const cleanTitle = title.replace(/:/g, '');
    const variants = season !== null
        ? [
            `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season < 10 ? '0' + season : season}/`,
            `/tvs/${encodeURIComponent(cleanTitle)}/Season%20${season}/`
        ]
        : [
            `/movies/${encodeURIComponent(`${cleanTitle} (${year})`)}/`
        ];

    for (const variant of variants) {
        try {
            const res = await axios.get(DAHMER_MOVIES_API + variant, {
                headers: REQUEST_HEADERS,
                timeout: 10000,
                responseType: 'text'
            });
            if (res.data) {
                return { html: res.data, dirUrl: DAHMER_MOVIES_API + variant };
            }
        } catch {
            // Try next variant
        }
    }

    return null;
}

/**
 * Get TMDB details (title and year) for a given ID
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} tmdbApiKey - TMDB API key
 * @returns {Promise<Object|null>} Object with title and year, or null on error
 */
async function getTmdbDetails(tmdbId, mediaType, tmdbApiKey) {
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const { data } = await axios.get(
            `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${tmdbApiKey}`,
            { timeout: 8000 }
        );
        return {
            title: data.title || data.name || '',
            year: (data.release_date || data.first_air_date || '').substring(0, 4)
        };
    } catch (err) {
        console.error(`[DahmerMovies] TMDB lookup failed: ${err.message}`);
        return null;
    }
}

// ============================================
// Main Stream Function (exported)
// ============================================

/**
 * Fetch streams from DahmerMovies
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} seasonNum - Season number (tv only)
 * @param {number} episodeNum - Episode number (tv only)
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[DahmerMovies] Searching for ${mediaType} ${tmdbId}`);

    // Get TMDB API key - prefer environment variable, fallback to utility
    const tmdbApiKey = process.env.TMDB_API_KEY || getTmdbApiKey();
    if (!tmdbApiKey) {
        console.error('[DahmerMovies] No TMDB API key found.');
        return [];
    }

    // Fetch TMDB details
    const details = await getTmdbDetails(tmdbId, mediaType, tmdbApiKey);
    if (!details || !details.title) {
        console.log(`[DahmerMovies] No title found for TMDB ID: ${tmdbId}`);
        return [];
    }

    const { title, year } = details;
    console.log(`[DahmerMovies] Title: ${title} (${year})`);

    // Fetch directory listing
    const seasonParam = mediaType === 'tv' ? seasonNum : null;
    const dir = await fetchDirectory(title, year, seasonParam);
    if (!dir) {
        console.log(`[DahmerMovies] Directory not found for "${title}"`);
        return [];
    }

    let paths = parseLinks(dir.html);

    // Filter by episode if TV series
    if (mediaType === 'tv' && seasonNum !== null && episodeNum !== null) {
        const epStr = String(episodeNum).padStart(2, '0');
        const seStr = String(seasonNum).padStart(2, '0');
        const epFiltered = paths.filter(p => {
            const name = p.text.toLowerCase();
            return name.includes(`s${seStr}e${epStr}`) || name.includes(`e${epStr}`);
        });
        if (epFiltered.length > 0) {
            paths = epFiltered;
        }
    }

    // Sort by quality (4K first, then 1080p, etc.)
    paths.sort((a, b) => (/2160p|4k/i.test(b.text) ? 1 : 0) - (/2160p|4k/i.test(a.text) ? 1 : 0));

    const streams = [];

    for (const path of paths.slice(0, 10)) {
        let directUrl;
        if (path.href.startsWith('http')) {
            directUrl = path.href;
        } else if (path.href.includes('/movies/') || path.href.includes('/tvs/')) {
            directUrl = DAHMER_MOVIES_API + (path.href.startsWith('/') ? '' : '/') + path.href;
        } else {
            directUrl = dir.dirUrl + path.href;
        }
        directUrl = decodeURI(directUrl.replace(/([^:]\/)\/+/g, '$1'));

        const fileName = path.text;

        // Determine language
        const isMulti = /\b(HIN|TAM|TEL|Multi|Dual|DUB|Multi-Audio|MULTI)\b/i.test(fileName);
        const hasEngTag = /\b(Eng|English)\b/i.test(fileName);
        const isEnglishTitle = /^[a-zA-Z0-9\s?!\-:]+$/.test(title);
        let language = 'Original';
        if (isMulti) {
            language = 'Multi Audio';
        } else if (isEnglishTitle && hasEngTag) {
            language = 'English';
        }

        // Extract format and resolution
        const formatMatch = fileName.match(/\.(mkv|mp4|m3u8|avi|webm)$/i);
        const fileFormat = formatMatch ? formatMatch[1].toUpperCase() : 'LINK';
        const resolution = fileName.match(/\b(2160p|1080p|720p|4[Kk])\b/)?.[0] || '1080p';

        // Clean title info
        const info = fileName
            .replace(/\.(mkv|mp4|avi|webm|m3u8)$/i, '')
            .replace(/[\[\]()._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        streams.push({
            name: 'DahmerMovies Direct Stream',
            title: `${resolution} | ${language} | ${path.size} | ${fileFormat} | ${info}`,
            url: directUrl,
            quality: resolution,
            provider: 'dahmermovies',
            headers: {
                'User-Agent': REQUEST_HEADERS['User-Agent'],
                'Referer': DAHMER_MOVIES_API + '/',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate'
            },
            size: path.size,
            format: fileFormat,
            isHLS: directUrl.includes('.m3u8'),
            isMP4: directUrl.includes('.mp4'),
            isMKV: directUrl.includes('.mkv')
        });
    }

    console.log(`[DahmerMovies] Found ${streams.length} streams`);
    return streams;
}

// ============================================
// Export
// ============================================

module.exports = {
    getStreams,
    scrape: getStreams
};