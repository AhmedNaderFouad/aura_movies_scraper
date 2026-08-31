// =============================================
// Environment Variables Loading
// =============================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// =============================================
// Module Dependencies
// =============================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware configuration
app.use(cors());
app.use(express.json());

// =============================================
// Helper Utilities
// =============================================
/**
 * Retrieve the first non-internal IPv4 address of the local machine.
 * @returns {string} Local IP address or 'localhost' fallback.
 */
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Check and log loaded environment variables
console.log('\n📋 Environment Variables Status:');
console.log(`   FEBBOX_REGION:  ${process.env.FEBBOX_REGION || '❌ NOT SET'}`);
console.log(`   SHOWBOX_COOKIE: ${process.env.SHOWBOX_COOKIE ? '✅ LOADED (' + process.env.SHOWBOX_COOKIE.substring(0, 20) + '...)' : '❌ NOT SET'}`);
console.log(`   TMDB_API_KEY:   ${process.env.TMDB_API_KEY ? '✅ LOADED' : '❌ NOT SET'}\n`);

// =============================================
// Proxy Endpoint for Stream Content (Videasy Dedicated)
// =============================================
app.get('/api/proxy-stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
        const decodedUrl = decodeURIComponent(targetUrl);
        console.log(`[Proxy Videasy] Fetching stream: ${decodedUrl.substring(0, 80)}...`);

        // Mandatory headers to bypass hotlinking and geo-restrictions
        const proxyHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': req.query.referer || 'https://player.videasy.net/',
            'Origin': req.query.origin || 'https://player.videasy.net',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
        };

        if (req.headers.range) {
            proxyHeaders['Range'] = req.headers.range;
        }

        const isM3u8 = decodedUrl.includes('.m3u8') || req.headers.accept?.includes('mpegurl');

        // Handle HLS Playlist Manifest (.m3u8) parsing and segment rewriting
        if (isM3u8) {
            const response = await axios.get(decodedUrl, {
                headers: proxyHeaders,
                responseType: 'text',
                timeout: 30000,
            });

            const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
            const hostIp = getLocalIp();
            const proxyBase = `http://${hostIp}:${PORT}/api/proxy-stream?url=`;

            // Rewrite relative segment paths so every chunk routes through this proxy
            const manifestContent = response.data.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const absoluteUrl = trimmed.startsWith('http') ? trimmed : `${baseUrl}${trimmed}`;
                    return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(manifestContent);
        }

        // Direct stream pipe for video segments and media chunks (TS/MP4/MKV)
        const response = await axios({
            method: 'get',
            url: decodedUrl,
            headers: proxyHeaders,
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
        });

        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        response.data.pipe(res);

        response.data.on('error', (err) => {
            console.error('[Proxy Videasy] Stream pipeline error:', err.message);
            if (!res.headersSent) res.status(500).json({ error: 'Stream transfer error' });
        });

    } catch (error) {
        console.error('[Proxy Videasy] Failed:', error.response ? `${error.response.status} - ${error.response.statusText}` : error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to proxy stream', details: error.message });
        }
    }
});

// =============================================
// Provider Metadata Registry
// =============================================
const PROVIDER_META = {
    'allwish': { name: 'AllWish', type: 'direct', priority: 1 },
    'vixsrc': { name: 'VixSrc', type: 'direct', priority: 1 },
    'showbox': { name: 'Showbox', type: 'direct', priority: 2 },
    'vaplayer': { name: 'VaPlayer', type: 'direct', priority: 2 },
    'onetouchtv': { name: 'OneTouchTV', type: 'direct', priority: 2 },
    'netmirror': { name: 'netmirror', type: 'direct', priority: 2 },
    'vidlink': { name: 'VidLink', type: 'direct', priority: 2 },
    //'icefy': { name: 'Icefy', type: 'direct', priority: 1 },
    //'dahmermovies': { name: 'DahmerMovies', type: 'direct', priority: 2 },
    //'fourkHDhub': { name: '4KHDHub', type: 'direct', priority: 2 },
    //'videasy': { name: 'Videasy', type: 'direct', priority: 1 },
    //'castletv': { name: 'CastleTV', type: 'direct', priority: 2 },
    //'hdghartv': { name: 'HDGharTV', type: 'direct', priority: 2 },
    //'zxcstreams': { name: 'ZXCStreams', type: 'direct', priority: 2 },

};

const PROVIDER_PRIORITY = [
    'vixsrc',
    'vaplayer',
    'allwish',
    'onetouchtv',
    'netmirror',
    'showbox',
    'vidlink',
    //'castletv',
    //'hdghartv',
    //'videasy',
    //'zxcstreams',
    //'dahmermovies',
    //'icefy',
    //'fourkHDhub',


];

// =============================================
// Application Routes
// =============================================

// Serve Stremio / Extension manifest file
app.get('/manifest.json', (req, res) => {
    const manifestPath = path.join(__dirname, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        res.sendFile(manifestPath);
    } else {
        res.status(404).json({ error: 'manifest.json not found' });
    }
});

// Retrieve list of all available providers
app.get('/providers', (req, res) => {
    const providersList = Object.keys(PROVIDER_META).map(key => ({
        id: key,
        name: PROVIDER_META[key].name,
        type: PROVIDER_META[key].type,
        priority: PROVIDER_META[key].priority,
    }));
    res.json({
        success: true,
        count: providersList.length,
        providers: providersList,
    });
});

// Primary stream discovery API endpoint
app.get('/api/stream', async (req, res) => {
    const { provider, tmdb_id, type, season, episode, cookie, region } = req.query;

    if (!tmdb_id) {
        return res.status(400).json({
            success: false,
            message: 'tmdb_id query parameter is required.',
        });
    }

    const mediaType = type || 'movie';
    const seasonNum = season ? parseInt(season, 10) : 1;
    const episodeNum = episode ? parseInt(episode, 10) : 1;

    const userCookie = cookie || process.env.SHOWBOX_COOKIE || null;
    const regionPreference = region || process.env.FEBBOX_REGION || 'USA7';

    let providersToUse = [];
    if (provider) {
        const cleanProvider = provider.toLowerCase().trim();
        const matchedKey = Object.keys(PROVIDER_META).find(key => key.toLowerCase() === cleanProvider);
        if (matchedKey) {
            providersToUse = [matchedKey];
        } else {
            return res.status(404).json({
                success: false,
                message: `Provider '${provider}' not found.`,
            });
        }
    } else {
        providersToUse = PROVIDER_PRIORITY;
    }

    console.log(`[API] Processing stream request for TMDB: ${tmdb_id} via [${providersToUse.join(', ')}]`);

    try {
        const results = {};
        const hostIp = getLocalIp();
        const baseUrl = `http://${hostIp}:${PORT}`;

        for (const providerName of providersToUse) {
            let providerPath;

            const distPath = path.join(__dirname, 'dist', 'providers', `${providerName}.js`);
            const srcPath = path.join(__dirname, 'src', 'providers', `${providerName}.js`);

            if (fs.existsSync(distPath)) {
                providerPath = distPath;
            } else if (fs.existsSync(srcPath)) {
                providerPath = srcPath;
            } else {
                results[providerName] = {
                    success: false,
                    error: `Provider module missing: ${providerName}.js`,
                    streams: [],
                    count: 0,
                };
                continue;
            }

            try {
                // Clear module cache to guarantee fresh scraper executions
                delete require.cache[require.resolve(providerPath)];
                const scraperModule = require(providerPath);
                const fetchFunction = scraperModule.getStreams || scraperModule.scrape;

                if (typeof fetchFunction !== 'function') {
                    results[providerName] = {
                        success: false,
                        error: `Invalid scraper export: missing 'getStreams' or 'scrape' function.`,
                        streams: [],
                        count: 0,
                    };
                    continue;
                }

                console.log(`[API] Executing provider scraper: ${providerName}`);

                const isShowBox = ['showbox', 'febboxapi'].includes(providerName.toLowerCase());
                const activeCookie = isShowBox ? userCookie : null;

                if (isShowBox) {
                    if (activeCookie) {
                        console.log(`[API] 🔑 ShowBox session authentication active`);
                    } else {
                        console.warn('[API] ⚠️ No active session cookie found for ShowBox provider');
                    }
                }

                let streams;
                try {
                    // Pass proxy baseUrl specifically when executing the Videasy scraper module
                    if (providerName.toLowerCase() === 'videasy') {
                        streams = await fetchFunction(tmdb_id, mediaType, seasonNum, episodeNum, regionPreference, activeCookie, baseUrl);
                    } else {
                        streams = await fetchFunction(tmdb_id, mediaType, seasonNum, episodeNum, regionPreference, activeCookie);
                    }
                } catch (paramError) {
                    console.log(`[API] ${providerName} failed signature call, attempting legacy fallback...`);
                    try {
                        streams = await fetchFunction(tmdb_id, mediaType, seasonNum, episodeNum);
                    } catch (legacyError) {
                        streams = await fetchFunction(tmdb_id, mediaType);
                    }
                }

                if (streams && streams.length > 0) {
                    console.log(`[API] ✅ ${providerName} resolved ${streams.length} playable source(s)`);
                } else {
                    console.log(`[API] ⚠️ ${providerName} returned 0 sources`);
                }

                results[providerName] = {
                    success: true,
                    streams: streams || [],
                    count: streams ? streams.length : 0,
                    error: null,
                };

            } catch (err) {
                console.error(`[API Scraper Error] ${providerName}:`, err.message);
                results[providerName] = {
                    success: false,
                    error: err.message,
                    streams: [],
                    count: 0,
                };
            }
        }

        // Evaluate overall best playable stream source
        let bestProvider = null;
        let bestStream = null;
        let bestStreams = [];

        for (const [providerName, result] of Object.entries(results)) {
            if (result.success && result.streams && result.streams.length > 0) {
                const hls = result.streams.find(s => s.url && (s.url.includes('.m3u8') || s.type === 'hls'));
                const direct = result.streams.find(s => s.url && (s.url.includes('.mp4') || s.url.includes('.mkv')));
                const fallback = result.streams[0];
                const best = hls || direct || fallback;

                if (best && (!bestStream || result.streams.length > bestStreams.length)) {
                    bestProvider = providerName;
                    bestStream = best;
                    bestStreams = result.streams;
                }
            }
        }

        const success = bestStream !== null;

        const response = {
            success,
            provider: provider || 'all',
            tmdb_id,
            type: mediaType,
            season: seasonNum,
            episode: episodeNum,
            results,
            best: success ? {
                provider: bestProvider,
                providerName: PROVIDER_META[bestProvider]?.name || bestProvider,
                stream: bestStream,
                totalStreams: bestStreams.length,
            } : null,
            count: success ? bestStreams.length : 0,
            streams: success ? bestStreams : [],
        };

        res.json(response);

    } catch (error) {
        console.error('[API Critical Error]', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Root landing page endpoint
app.get('/', (req, res) => {
    const cookieStatus = process.env.SHOWBOX_COOKIE ? '✅ LOADED' : '❌ NOT SET';
    res.send(`
        <h1>🎬 Aura Movies Backend API</h1>
        <p><strong>Status:</strong> Running ✅</p>
        <p><strong>Active Providers:</strong> ${Object.keys(PROVIDER_META).length}</p>
        <p><strong>ShowBox Cookie:</strong> ${cookieStatus}</p>
        <p><strong>FebBox Region:</strong> ${process.env.FEBBOX_REGION || 'USA7 (default)'}</p>
        <br>
        <h3>📌 Test Endpoints:</h3>
        <ul>
            <li><a href="/providers">/providers</a> - List all providers</li>
            <li><a href="/api/stream?tmdb_id=550&type=movie">/api/stream?tmdb_id=550&type=movie</a></li>
            <li><a href="/api/stream?tmdb_id=969681&type=movie&provider=videasy">/api/stream?tmdb_id=969681&type=movie&provider=videasy</a></li>
        </ul>
    `);
});

// =============================================
// Server Initialization
// =============================================
app.listen(PORT, () => {
    const ip = getLocalIp();
    console.log(`\n✅ Aura Movies Backend running at: http://${ip}:${PORT}/`);
    console.log(`📺 Active Providers Registered: ${Object.keys(PROVIDER_META).length}`);
    console.log(`🔑 ShowBox Cookie: ${process.env.SHOWBOX_COOKIE ? '✅ Loaded from .env' : '❌ Not found in .env'}`);
    console.log(`🌍 FebBox Region: ${process.env.FEBBOX_REGION || 'USA7 (default)'}\n`);
});