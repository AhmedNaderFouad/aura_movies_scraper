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

// Headers used when fetching media from the CDN. VLC user-agent is required
// because the CDN blocks requests coming from generic browser or player UAs.
const STREAM_FETCH_HEADERS = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
};

const PROXY_BASE = process.env.PROXY_BASE || '';

const VIDLINK_DOMAINS = [
    'https://vidlink.pro',
    'https://vidlink.cc',
    'https://vidlink.to',
    'https://vidlink.xyz'
];

const ENCRYPTION_METHODS = [
    'enc-vidlink',
    'enc-vidlink-v2',
    'enc-vidlink-pro',
    'encrypt-vidlink'
];

// -----------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------

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

function unpackPackedScript(script) {
    try {
        const packedMatch = script.match(/eval\s*\(\s*function\s*\([^)]*\)\s*\{[^}]*\}\s*\([^)]*\)\s*\)/);
        if (packedMatch) {
            const fn = new Function(`return (${packedMatch[0]})`);
            return fn();
        }
        const atobMatch = script.match(/atob\(["']([^"']+)["']\)/g);
        if (atobMatch) {
            for (const match of atobMatch) {
                const base64 = match.replace(/atob\(["']/, '').replace(/["']\)/, '');
                try {
                    return Buffer.from(base64, 'base64').toString('utf-8');
                } catch (e) { }
            }
        }
        return script;
    } catch (e) { return script; }
}

// -----------------------------------------------------------------
// MP4 Quality Detection
// -----------------------------------------------------------------

// Parse the tkhd (track header) box from an MP4 buffer to extract the
// video width and height. Returns { width, height } or null.
function parseMp4Tkhd(buffer) {
    try {
        const moovIdx = buffer.indexOf('moov');
        if (moovIdx === -1) return null;

        const tkhdStrIdx = buffer.indexOf('tkhd', moovIdx);
        if (tkhdStrIdx === -1) return null;

        const tkhdStart = tkhdStrIdx - 4;
        if (tkhdStart < 0) return null;

        const version = buffer[tkhdStart + 8];

        let widthOffset;
        if (version === 1) {
            widthOffset = tkhdStart + 8 + 4 + 8 + 8 + 4 + 4 + 8 + 8 + 2 + 2 + 2 + 2 + 36;
        } else {
            widthOffset = tkhdStart + 8 + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36;
        }

        if (widthOffset + 8 > buffer.length) return null;

        const width = buffer.readUInt32BE(widthOffset) / 65536;
        const height = buffer.readUInt32BE(widthOffset + 4) / 65536;

        if (width > 0 && height > 0 && width < 10000 && height < 10000) {
            return { width: Math.round(width), height: Math.round(height) };
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Estimate the quality label based purely on the file size in bytes.
// This is a fallback used when MP4 header parsing is not possible.
function estimateQualityFromSize(bytes) {
    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;

    if (bytes >= 3 * GB) return '2160p';
    if (bytes >= 1.5 * GB) return '1080p';
    if (bytes >= 700 * MB) return '720p';
    if (bytes >= 300 * MB) return '480p';
    if (bytes >= 100 * MB) return '360p';
    return '240p';
}

function labelToHeight(label) {
    const match = String(label).match(/(\d{3,4})/);
    return match ? parseInt(match[1], 10) : 0;
}

// Analyze a single media URL and return an enriched quality object.
// Steps:
//   1. HEAD request to read Content-Length.
//   2. Partial GET (Range bytes=0-2MB) to parse the MP4 header and get
//      the real resolution.
//   3. Fallback to size estimation if the header cannot be parsed.
async function analyzeMediaQuality(url) {
    const result = { url, width: 0, height: 0, size: 0, label: 'Auto', isAuto: true };

    // Step 1: HEAD request for Content-Length
    try {
        const headResp = await axios.head(url, {
            headers: STREAM_FETCH_HEADERS,
            timeout: 8000,
            validateStatus: () => true,
        });
        const len = parseInt(headResp.headers['content-length'] || '0', 10);
        if (len > 0) result.size = len;
    } catch (e) { /* ignore */ }

    // Step 2: Partial fetch to parse MP4 header
    try {
        const rangeResp = await axios.get(url, {
            headers: { ...STREAM_FETCH_HEADERS, 'Range': 'bytes=0-2097151' },
            timeout: 8000,
            responseType: 'arraybuffer',
            validateStatus: (s) => s === 200 || s === 206,
        });
        const buffer = Buffer.from(rangeResp.data);
        const parsed = parseMp4Tkhd(buffer);
        if (parsed && parsed.height > 0) {
            result.width = parsed.width;
            result.height = parsed.height;
            result.label = `${parsed.height}p`;
            result.isAuto = false;
            return result;
        }
    } catch (e) { /* ignore */ }

    // Step 3: Size-based fallback
    if (result.size > 0) {
        result.label = estimateQualityFromSize(result.size);
        result.height = labelToHeight(result.label);
        result.isAuto = false;
    }

    return result;
}

// Analyze a list of URLs in parallel and assign relative quality labels
// based on their sizes. This ensures no two entries share the same label
// when their actual resolutions cannot be parsed.
async function analyzeMediaList(urls) {
    const results = await Promise.all(urls.map(u => analyzeMediaQuality(u)));

    // Detect duplicate labels (e.g. all resolved to "Auto" or same size tier)
    const labelCounts = {};
    for (const r of results) labelCounts[r.label] = (labelCounts[r.label] || 0) + 1;

    // Assign differentiated labels based on relative size when needed
    const sizeSorted = [...results].sort((a, b) => b.size - a.size);
    const tierLabels = ['2160p', '1080p', '720p', '480p', '360p', '240p'];

    for (const r of results) {
        if (labelCounts[r.label] > 1 || r.label === 'Auto') {
            const rank = sizeSorted.indexOf(r);
            if (rank >= 0 && rank < tierLabels.length) {
                r.label = tierLabels[rank];
                r.height = labelToHeight(r.label);
                r.isAuto = false;
            }
        }
    }

    return results;
}

// Extract available qualities from an HLS master playlist.
async function extractQualitiesFromM3u8(streamUrl) {
    if (!streamUrl || typeof streamUrl !== 'string') return [];

    if (!/\.m3u8(\?|$)/i.test(streamUrl)) return [];

    try {
        const response = await axios.get(streamUrl, {
            headers: STREAM_FETCH_HEADERS,
            timeout: 10000,
            validateStatus: () => true,
            responseType: 'text',
        });

        if (response.status !== 200 || typeof response.data !== 'string') return [];

        const content = response.data;
        if (!content.includes('#EXT-X-STREAM-INF')) return [];

        const qualities = [];
        const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('#EXT-X-STREAM-INF')) continue;

            const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);

            const nextLine = (lines[i + 1] || '').trim();
            if (!nextLine || nextLine.startsWith('#')) continue;

            const qualityUrl = nextLine.startsWith('http') ? nextLine : `${baseUrl}${nextLine}`;

            let label = 'Auto';
            let width = 0;
            let height = 0;

            if (resolutionMatch) {
                width = parseInt(resolutionMatch[1], 10);
                height = parseInt(resolutionMatch[2], 10);
                label = `${height}p`;
            } else if (bandwidthMatch) {
                label = `${Math.round(parseInt(bandwidthMatch[1], 10) / 1000)}kbps`;
            }

            qualities.push({
                label, url: qualityUrl, width, height,
                bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0,
                isAuto: false,
            });
        }

        qualities.sort((a, b) => b.height - a.height);
        return qualities;
    } catch (error) {
        return [];
    }
}

// -----------------------------------------------------------------
// VidLink API Response Parsing
// -----------------------------------------------------------------

// Scan the VidLink API response for every URL we can extract, no matter
// which field it lives in.
function extractAllSourcesFromApiResponse(apiData) {
    const sources = [];
    const seen = new Set();

    const pushSource = (url, label, height) => {
        if (!url || typeof url !== 'string') return;
        if (seen.has(url)) return;
        seen.add(url);
        sources.push({
            url,
            type: url.includes('.m3u8') ? 'hls' : 'mp4',
            label: String(label || 'Auto'),
            height: height || 0,
        });
    };

    // Common field: stream.playlist (HLS master URL)
    if (apiData.stream?.playlist) pushSource(apiData.stream.playlist, 'Auto', 0);

    // Look for quality arrays in every plausible location
    const streamObj = apiData.stream || {};
    const possibleArrays = [
        streamObj.qualities, streamObj.sources, streamObj.variants,
        apiData.qualities, apiData.sources, apiData.variants,
    ];

    for (const arr of possibleArrays) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
            const url = item.url || item.file || item.src || item.link;
            if (!url) continue;
            const quality = item.quality || item.label || item.resolution || 'Auto';
            const height = item.height || labelToHeight(quality);
            pushSource(url, quality, height);
        }
    }

    // Last resort: extract every URL we can find in the JSON
    if (sources.length === 0) {
        const dataStr = JSON.stringify(apiData);
        for (const url of extractUrlsFromText(dataStr)) {
            pushSource(url, 'Auto', 0);
        }
    }

    return sources;
}

// -----------------------------------------------------------------
// VidLink Extraction Methods
// -----------------------------------------------------------------

async function tryMultipleEncryption(tmdbId, mediaType, seasonNum, episodeNum, domain, method) {
    try {
        const encUrl = `https://enc-dec.app/api/${method}?text=${encodeURIComponent(String(tmdbId))}`;
        const encRes = await axios.get(encUrl, {
            headers: VIDLINK_HEADERS, timeout: 8000, validateStatus: () => true,
        });

        if (encRes.status !== 200 || !encRes.data) return null;
        const encodedTmdb = encRes.data?.result;
        if (!encodedTmdb) return null;

        const apiUrl = mediaType === 'tv'
            ? `${domain}/api/b/tv/${encodedTmdb}/${seasonNum}/${episodeNum}?multiLang=0`
            : `${domain}/api/b/movie/${encodedTmdb}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, {
            headers: VIDLINK_HEADERS, timeout: 10000, validateStatus: () => true,
        });

        if (apiRes.status === 200 && apiRes.data) {
            const sources = extractAllSourcesFromApiResponse(apiRes.data);
            if (sources.length > 0) return { sources, method, domain };
        }
        return null;
    } catch (e) { return null; }
}

async function tryMultipleDomains(tmdbId, mediaType, seasonNum, episodeNum) {
    for (const domain of VIDLINK_DOMAINS) {
        for (const method of ENCRYPTION_METHODS) {
            const result = await tryMultipleEncryption(tmdbId, mediaType, seasonNum, episodeNum, domain, method);
            if (result && result.sources && result.sources.length > 0) return result;
        }
    }
    return null;
}

async function tryDirectUrl(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const apiUrl = mediaType === 'tv'
            ? `https://vidlink.pro/api/b/tv/${tmdbId}/${seasonNum}/${episodeNum}?multiLang=0`
            : `https://vidlink.pro/api/b/movie/${tmdbId}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, {
            headers: VIDLINK_HEADERS, timeout: 8000, validateStatus: () => true,
        });

        if (apiRes.status === 200 && apiRes.data) {
            const sources = extractAllSourcesFromApiResponse(apiRes.data);
            if (sources.length > 0) return { sources, method: 'direct' };
        }
        return null;
    } catch (e) { return null; }
}

async function tryScraperMethod(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        const embedUrl = mediaType === 'tv'
            ? `https://vidlink.pro/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `https://vidlink.pro/movie/${tmdbId}`;

        const response = await axios.get(embedUrl, {
            headers: { ...VIDLINK_HEADERS, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
            timeout: 10000,
        });

        const html = response.data;
        const $ = cheerio.load(html);

        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) return { url: iframeSrc, method: 'scraper' };

        const scripts = $('script').toArray();
        for (const script of scripts) {
            const content = $(script).html() || '';
            const unpacked = unpackPackedScript(content);
            const urls = extractUrlsFromText(unpacked);
            if (urls.length > 0) return { url: urls[0], method: 'scraper' };
        }

        const urls = extractUrlsFromText(html);
        if (urls.length > 0) return { url: urls[0], method: 'scraper' };

        return null;
    } catch (e) { return null; }
}

// -----------------------------------------------------------------
// Proxy URL Helper
// -----------------------------------------------------------------

function maybeProxyUrl(url) {
    if (!PROXY_BASE) return url;
    const base = PROXY_BASE.replace(/\/$/, '');
    return `${base}/stream-proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent('https://vidlink.pro')}`;
}

// -----------------------------------------------------------------
// Stream Object Builder
// -----------------------------------------------------------------

// Given a set of sources, build a unified stream object with a full
// qualities array. Each entry in the array carries its own real label.
async function buildStreamObject(result) {
    let qualities = [];

    const rawSources = result.sources || (result.url ? [{ url: result.url, type: 'hls', label: 'Auto' }] : []);
    const allUrls = rawSources.map(s => s.url);

    // HLS sources: try to expand the master playlist into its variants
    const hlsSources = rawSources.filter(s => s.url.includes('.m3u8'));
    const mp4Sources = rawSources.filter(s => !s.url.includes('.m3u8'));

    // Expand each HLS master into individual variants
    for (const src of hlsSources) {
        const variants = await extractQualitiesFromM3u8(src.url);
        if (variants.length > 0) {
            qualities.push(...variants);
        } else {
            qualities.push({
                label: src.label || 'Auto', url: src.url,
                width: 0, height: 0, bandwidth: 0,
                isAuto: !src.label || src.label === 'Auto',
            });
        }
    }

    // Analyze MP4 sources to determine real quality per file
    if (mp4Sources.length > 0) {
        const analyzed = await analyzeMediaList(mp4Sources.map(s => s.url));

        // Prefer labels coming from the API if they are meaningful
        for (let i = 0; i < analyzed.length; i++) {
            const src = mp4Sources[i];
            const info = analyzed[i];
            const apiLabel = src.label && src.label !== 'Auto' ? src.label : null;
            qualities.push({
                label: apiLabel || info.label,
                url: info.url,
                width: info.width,
                height: info.height,
                bandwidth: 0,
                size: info.size,
                isAuto: !(apiLabel || !info.isAuto),
            });
        }
    }

    // If we somehow have no qualities yet, fall back to the first source
    if (qualities.length === 0 && rawSources.length > 0) {
        qualities = rawSources.map(s => ({
            label: s.label || 'Auto', url: s.url,
            width: 0, height: s.height || 0, bandwidth: 0,
            isAuto: true,
        }));
    }

    // Sort by height descending
    qualities.sort((a, b) => (b.height || 0) - (a.height || 0));

    const best = qualities[0] || { label: 'Auto', url: allUrls[0] || '' };
    const primaryUrl = best.url || allUrls[0] || '';
    const hasHLS = primaryUrl.includes('.m3u8');
    const hasMP4 = primaryUrl.includes('.mp4');

    return {
        name: result.name,
        title: result.title,
        url: maybeProxyUrl(primaryUrl),
        quality: best.label,
        provider: 'vidlink',
        headers: {
            'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
            'Accept': '*/*',
        },
        qualities: qualities.map(q => ({
            label: q.label,
            url: maybeProxyUrl(q.url),
            width: q.width || 0,
            height: q.height || 0,
            bandwidth: q.bandwidth || 0,
            size: q.size || 0,
            isAuto: !!q.isAuto,
        })),
        isHLS: hasHLS,
        isMP4: hasMP4,
        sourceMethod: result.method,
    };
}

// -----------------------------------------------------------------
// Main Export Function
// -----------------------------------------------------------------

async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    // Attempt 1: Direct API
    const directResult = await tryDirectUrl(tmdbId, mediaType, seasonNum, episodeNum);
    if (directResult) {
        return [await buildStreamObject({
            name: 'Vidlink (Direct)',
            title: `Vidlink Direct | ${tmdbId}`,
            sources: directResult.sources,
            method: directResult.method,
        })];
    }

    // Attempt 2: Encrypted API across multiple domains
    const encryptedResult = await tryMultipleDomains(tmdbId, mediaType, seasonNum, episodeNum);
    if (encryptedResult) {
        return [await buildStreamObject({
            name: `Vidlink (${encryptedResult.method})`,
            title: `Vidlink Encrypted | ${tmdbId}`,
            sources: encryptedResult.sources,
            method: encryptedResult.method,
        })];
    }

    // Attempt 3: Scrape the embed page HTML
    const scraperResult = await tryScraperMethod(tmdbId, mediaType, seasonNum, episodeNum);
    if (scraperResult) {
        return [await buildStreamObject({
            name: 'Vidlink (Scraper)',
            title: `Vidlink Scraper | ${tmdbId}`,
            sources: [{ url: scraperResult.url, label: 'Auto', type: 'hls' }],
            method: scraperResult.method,
        })];
    }

    console.log('[Vidlink] No streams found');
    return [];
}

module.exports = {
    getStreams,
    scrape: getStreams,
    extractQualitiesFromM3u8,
    analyzeMediaQuality,
};