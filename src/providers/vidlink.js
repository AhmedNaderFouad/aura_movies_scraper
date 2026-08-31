// src/providers/vidlink.js
// VidLink Provider - Multiple fallback strategies for VidLink streams
// Part of AuraMovies local scrapers collection

const axios = require('axios');
const cheerio = require('cheerio');

// -----------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------


const TMDB_API_KEY = process.env.TMDB_API_KEY || '2194dd3db7b2fbdc87cfc20cbda3b0d2';

const VIDLINK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer': 'https://vidlink.pro',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://vidlink.pro'
};

// Alternative VidLink domains
const VIDLINK_DOMAINS = [
    'https://vidlink.pro',
    'https://vidlink.cc',
    'https://vidlink.to',
    'https://vidlink.xyz'
];

// Encryption methods to try
const ENCRYPTION_METHODS = [
    'enc-vidlink',
    'enc-vidlink-v2',
    'enc-vidlink-pro',
    'encrypt-vidlink'
];

// -----------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------

/**
 * Decode Base64 string with multiple depth attempts
 */
function deepBase64Decode(str, maxDepth = 5) {
    let decoded = str;
    for (let i = 0; i < maxDepth; i++) {
        try {
            const candidate = Buffer.from(decoded, 'base64').toString('utf-8');
            if (candidate === decoded) break;
            decoded = candidate;
        } catch (e) { break; }
    }
    return decoded;
}

/**
 * Extract all URLs from text using multiple patterns
 */
function extractUrlsFromText(text) {
    const urls = new Set();
    const patterns = [
        /(https?:\/\/[^\s"']+\.(?:m3u8|mp4|mkv|ts|m4v|webm)[^\s"']*)/gi,
        /(https?:\/\/[^\s"']+cloudflare\.com\/[^\s"']+)/gi,
        /(https?:\/\/[^\s"']+workers\.dev\/[^\s"']+)/gi,
        /(https?:\/\/[^\s"']+\.(?:cdn|storage|stream)[^\s"']+)/gi,
        /(https?:\/\/[^\s"']+vidlink[^\s"']*)/gi
    ];
    for (const pattern of patterns) {
        const matches = text.match(pattern) || [];
        for (const url of matches) {
            if (url) urls.add(url.trim());
        }
    }
    return Array.from(urls);
}

/**
 * Unpack packed/obfuscated JavaScript
 */
function unpackPackedScript(script) {
    try {
        const packedMatch = script.match(/eval\s*\(\s*function\s*\([^)]*\)\s*\{[^}]*\}\s*\([^)]*\)\s*\)/);
        if (packedMatch) {
            const fn = new Function(`return (${packedMatch[0]})`);
            const result = fn();
            return result;
        }
        const atobMatch = script.match(/atob\(["']([^"']+)["']\)/g);
        if (atobMatch) {
            for (const match of atobMatch) {
                const base64 = match.replace(/atob\(["']/, '').replace(/["']\)/, '');
                try {
                    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
                    return decoded;
                } catch (e) { }
            }
        }
        return script;
    } catch (e) { return script; }
}

// -----------------------------------------------------------------
// VidLink Extraction Methods
// -----------------------------------------------------------------

/**
 * Try encryption-based extraction
 */
async function tryMultipleEncryption(tmdbId, mediaType, seasonNum, episodeNum, domain, method) {
    try {
        const encUrl = `https://enc-dec.app/api/${method}?text=${encodeURIComponent(String(tmdbId))}`;
        console.log(`[Vidlink] Trying encryption: ${method}`);

        const encRes = await axios.get(encUrl, {
            headers: VIDLINK_HEADERS,
            timeout: 8000,
            validateStatus: () => true
        });

        if (encRes.status !== 200 || !encRes.data) return null;
        const encodedTmdb = encRes.data?.result;
        if (!encodedTmdb) return null;

        const apiUrl = mediaType === 'tv'
            ? `${domain}/api/b/tv/${encodedTmdb}/${seasonNum}/${episodeNum}?multiLang=0`
            : `${domain}/api/b/movie/${encodedTmdb}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, {
            headers: VIDLINK_HEADERS,
            timeout: 10000,
            validateStatus: () => true
        });

        if (apiRes.status === 200 && apiRes.data) {
            let playlist = apiRes.data.stream?.playlist;
            if (playlist) {
                return { url: playlist, method, domain };
            }
            const dataStr = JSON.stringify(apiRes.data);
            const extractedUrls = extractUrlsFromText(dataStr);
            if (extractedUrls.length > 0) {
                return { url: extractedUrls[0], method, domain };
            }
            const decrypted = deepBase64Decode(dataStr);
            const moreUrls = extractUrlsFromText(decrypted);
            if (moreUrls.length > 0) {
                return { url: moreUrls[0], method, domain };
            }
        }
        return null;
    } catch (e) {
        console.log(`[Vidlink] Method ${method} failed: ${e.message}`);
        return null;
    }
}

/**
 * Try all domains and encryption methods
 */
async function tryMultipleDomains(tmdbId, mediaType, seasonNum, episodeNum) {
    for (const domain of VIDLINK_DOMAINS) {
        for (const method of ENCRYPTION_METHODS) {
            try {
                console.log(`[Vidlink] Trying ${domain} with ${method}`);
                const result = await tryMultipleEncryption(tmdbId, mediaType, seasonNum, episodeNum, domain, method);
                if (result && result.url) {
                    console.log(`[Vidlink] Found stream using ${method} on ${domain}`);
                    return result;
                }
            } catch (e) {
                console.log(`[Vidlink] ${domain}/${method} failed: ${e.message}`);
            }
        }
    }
    return null;
}

/**
 * Try direct URL (no encryption)
 */
async function tryDirectUrl(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const apiUrl = mediaType === 'tv'
            ? `https://vidlink.pro/api/b/tv/${tmdbId}/${seasonNum}/${episodeNum}?multiLang=0`
            : `https://vidlink.pro/api/b/movie/${tmdbId}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, {
            headers: VIDLINK_HEADERS,
            timeout: 8000,
            validateStatus: () => true
        });

        if (apiRes.status === 200 && apiRes.data) {
            const playlist = apiRes.data.stream?.playlist;
            if (playlist) {
                return { url: playlist, method: 'direct' };
            }
            const dataStr = JSON.stringify(apiRes.data);
            const urls = extractUrlsFromText(dataStr);
            if (urls.length > 0) {
                return { url: urls[0], method: 'direct' };
            }
        }
        return null;
    } catch (e) {
        console.log(`[Vidlink] Direct URL failed: ${e.message}`);
        return null;
    }
}

/**
 * Try scraper method (extract from HTML)
 */
async function tryScraperMethod(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const embedUrl = mediaType === 'tv'
            ? `https://vidlink.pro/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `https://vidlink.pro/movie/${tmdbId}`;

        const response = await axios.get(embedUrl, {
            headers: {
                ...VIDLINK_HEADERS,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 10000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            return { url: iframeSrc, method: 'scraper' };
        }

        const scripts = $('script').toArray();
        for (const script of scripts) {
            const content = $(script).html() || '';
            const unpacked = unpackPackedScript(content);
            const urls = extractUrlsFromText(unpacked);
            if (urls.length > 0) {
                return { url: urls[0], method: 'scraper' };
            }
        }

        const urls = extractUrlsFromText(html);
        if (urls.length > 0) {
            return { url: urls[0], method: 'scraper' };
        }

        return null;
    } catch (e) {
        console.log(`[Vidlink] Scraper method failed: ${e.message}`);
        return null;
    }
}

// -----------------------------------------------------------------
// Main Export Function
// -----------------------------------------------------------------

/**
 * Main entry point for server.js to fetch VidLink streams.
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} seasonNum - Season number (tv only)
 * @param {number} episodeNum - Episode number (tv only)
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    // Attempt 1: Direct URL
    console.log('[Vidlink] Attempt 1: Direct URL');
    const directResult = await tryDirectUrl(tmdbId, mediaType, seasonNum, episodeNum);
    if (directResult) {
        return [{
            name: 'Vidlink (Direct)',
            title: `Vidlink Direct | ${tmdbId}`,
            url: directResult.url,
            quality: '1080p',
            provider: 'vidlink',
            headers: { 'Referer': 'https://vidlink.pro' },
            isHLS: directResult.url.includes('.m3u8'),
            isMP4: directResult.url.includes('.mp4')
        }];
    }

    // Attempt 2: Multiple Encryption Methods
    console.log('[Vidlink] Attempt 2: Multiple Encryption Methods');
    const encryptedResult = await tryMultipleDomains(tmdbId, mediaType, seasonNum, episodeNum);
    if (encryptedResult) {
        return [{
            name: `Vidlink (${encryptedResult.method})`,
            title: `Vidlink Encrypted | ${tmdbId}`,
            url: encryptedResult.url,
            quality: '1080p',
            provider: 'vidlink',
            headers: { 'Referer': 'https://vidlink.pro' },
            isHLS: encryptedResult.url.includes('.m3u8'),
            isMP4: encryptedResult.url.includes('.mp4')
        }];
    }

    // Attempt 3: Scraper Method
    console.log('[Vidlink] Attempt 3: Scraper Method');
    const scraperResult = await tryScraperMethod(tmdbId, mediaType, seasonNum, episodeNum);
    if (scraperResult) {
        return [{
            name: 'Vidlink (Scraper)',
            title: `Vidlink Scraper | ${tmdbId}`,
            url: scraperResult.url,
            quality: '1080p',
            provider: 'vidlink',
            headers: { 'Referer': 'https://vidlink.pro' },
            isHLS: scraperResult.url.includes('.m3u8'),
            isMP4: scraperResult.url.includes('.mp4')
        }];
    }

    console.log('[Vidlink] No streams found');
    return [];
}

module.exports = {
    getStreams,
    scrape: getStreams
};