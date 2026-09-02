const { createHash } = require('crypto');
const { getDetails, resolveImdbId } = require('../utils/tmdb');
const cloudscraper = require('cloudscraper');

// ============================================
// Core Configuration
// ============================================

const PORTALS = ['https://zxcstream.xyz', 'https://zxcprime.xyz'];
const INITIAL_BASE = 'https://r1.zxcstream.xyz';
const SALT = '3435443433';

const SERVERS = ['berkas', 'orion'];

const BASE_TTL = 30 * 60 * 1000;
const PROBE_SUBDOMAINS = ['r1', 'r2', 'r3', 'r4', 'v4', 'cdn', 'api', 'stream'];

// ============================================
// Environment Detection
// ============================================

const IS_VERCEL = process.env.VERCEL === '1' || process.env.NOW_REGION !== undefined;

// ============================================
// Direct Base URLs for Vercel
// ============================================

const DIRECT_BASES = [
    'https://r1.zxcstream.xyz',
    'https://r2.zxcstream.xyz',
    'https://r3.zxcstream.xyz',
    'https://r4.zxcstream.xyz',
    'https://v4.zxcstream.xyz',
    'https://cdn.zxcstream.xyz',
    'https://api.zxcstream.xyz',
    'https://zxcstream.xyz',
    'https://zxcprime.xyz',
];

if (process.env.ZXCSTREAMS_BASE) {
    DIRECT_BASES.unshift(process.env.ZXCSTREAMS_BASE);
}

// ============================================
// Constants and Helper Functions
// ============================================

const F = {
    id: 'rgrwsdsdfgwrwrwwr',
    fToken: 'xfgdfgdsffgrwgrwyjhkjt',
    ts: 'rdghhdghhfssft',
    token: 'ZDDVHJFGHYRHG',
    title: 'TUKTHFSSFGDGHJS',
    year: '53653TRFG647GF',
    season: 'adkljfhdahfladhfjahfjlahfhfljkadfdf',
    episode: '546745ygy46ytfgty',
    imdbId: '564745ygtuy5yi75yuy'
};

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
};

let _base = INITIAL_BASE;
let _baseValidatedAt = 0;
let discoveryPromise = null;
let _cachedBase = null;
let _cachedBaseAt = 0;

// Token cache to avoid repeated requests
const tokenCache = new Map();

function sha512Hex(data) {
    return createHash('sha512').update(data).digest('hex');
}

// ============================================
// Base Verification
// ============================================

async function verifyBase(base, timeout = 8000) {
    const rt = Date.now();
    const xt = sha512Hex(`${rt}:${SALT}:550`).slice(0, 64);

    try {
        const response = await cloudscraper({
            method: 'POST',
            url: `${base}/backend/token`,
            headers: {
                ...COMMON_HEADERS,
                Origin: base,
                'Content-Type': 'application/json',
                Referer: `${base}/player/movie/550`
            },
            body: JSON.stringify({ [F.id]: '550', [F.fToken]: xt, [F.ts]: rt }),
            timeout: timeout,
            gzip: true,
            followRedirect: true,
            retries: 1,
        });

        const data = JSON.parse(response);
        if (data[F.token]) {
            return base;
        }
        throw new Error('verify failed: no token in response');
    } catch (err) {
        throw new Error(`verify failed: ${err.message}`);
    }
}

// ============================================
// Base Discovery
// ============================================

async function tryPortal(portal) {
    try {
        const response = await cloudscraper({
            method: 'GET',
            url: portal,
            headers: { 'User-Agent': COMMON_HEADERS['User-Agent'] },
            followRedirect: true,
            timeout: 6000,
            gzip: true,
        });
        const redirectedBase = response.request.uri.origin;
        if (redirectedBase === portal) {
            throw new Error(`portal ${portal} did not redirect`);
        }
        return await verifyBase(redirectedBase, 8000);
    } catch (err) {
        throw err;
    }
}

async function probeSubdomain(sub) {
    return verifyBase(`https://${sub}.zxcstream.xyz`, 8000);
}

async function discoverBase() {
    if (_cachedBase && Date.now() - _cachedBaseAt < BASE_TTL) {
        return _cachedBase;
    }

    if (IS_VERCEL) {
        for (const base of DIRECT_BASES) {
            try {
                await verifyBase(base, 8000);
                console.log(`[ZXCStreams] Using direct base: ${base}`);
                _cachedBase = base;
                _cachedBaseAt = Date.now();
                return base;
            } catch (e) {
                // ignore
            }
        }
        throw new Error('No working base found');
    }

    const portalResults = await Promise.allSettled(PORTALS.map((portal) => tryPortal(portal)));
    for (const r of portalResults) {
        if (r.status === 'fulfilled') {
            console.log(`[ZXCStreams] Discovered base via portal redirect: ${r.value}`);
            _cachedBase = r.value;
            _cachedBaseAt = Date.now();
            return r.value;
        }
    }

    console.warn('[ZXCStreams] Both portals failed, falling back to subdomain probing');
    const settled = await Promise.allSettled(PROBE_SUBDOMAINS.map((sub) => probeSubdomain(sub)));
    for (const r of settled) {
        if (r.status === 'fulfilled') {
            console.log(`[ZXCStreams] Discovered base via subdomain probe: ${r.value}`);
            _cachedBase = r.value;
            _cachedBaseAt = Date.now();
            return r.value;
        }
    }

    console.warn('[ZXCStreams] All discovery methods failed, keeping last known base:', _base);
    return _base;
}

async function getBase() {
    if (Date.now() - _baseValidatedAt <= BASE_TTL) {
        return _base;
    }
    if (!discoveryPromise) {
        discoveryPromise = discoverBase()
            .then((base) => {
                _base = base;
                _baseValidatedAt = Date.now();
                return base;
            })
            .finally(() => {
                discoveryPromise = null;
            });
    }
    return discoveryPromise;
}

function invalidateBase() {
    _baseValidatedAt = 0;
    _cachedBase = null;
    _cachedBaseAt = 0;
}

function generateFrontendToken(tmdbId) {
    const rt = Date.now();
    const xt = sha512Hex(`${rt}:${SALT}:${tmdbId}`).slice(0, 64);
    return { xt, rt };
}

// ============================================
// Token Request with Cache
// ============================================

async function requestServerToken(base, tmdbId, referer) {
    const cacheKey = `${base}:${tmdbId}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 300000) {
        console.log(`[ZXCStreams] Using cached token for ${base}`);
        return cached.data;
    }

    const { xt, rt } = generateFrontendToken(tmdbId);
    const body = JSON.stringify({
        [F.id]: tmdbId,
        [F.fToken]: xt,
        [F.ts]: rt
    });

    let lastError;
    for (let attempt = 0; attempt < 1; attempt++) {
        try {
            const response = await cloudscraper({
                method: 'POST',
                url: `${base}/backend/token`,
                headers: {
                    ...COMMON_HEADERS,
                    Origin: base,
                    'Content-Type': 'application/json',
                    Referer: referer,
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                },
                body: body,
                timeout: 5000,
                gzip: true,
                followRedirect: true,
                retries: 1,
            });

            const data = JSON.parse(response);
            if (data[F.token]) {
                const result = { serverToken: data[F.token], serverTs: data[F.ts], xt };
                tokenCache.set(cacheKey, { data: result, timestamp: Date.now() });
                return result;
            }
            throw new Error('Invalid token response');
        } catch (err) {
            lastError = err;
            console.warn(`[ZXCStreams] Token attempt ${attempt + 1} on ${base} failed: ${err.message}`);
        }
    }
    throw lastError;
}

// ============================================
// Server Fetching
// ============================================

async function fetchServer(server, meta, type, season, episode) {
    let base = await getBase();

    const buildReferer = (b) =>
        `${b}/player/${type}/${meta.tmdbId}${season != null ? `/${season}/${episode}` : ''}`;

    let referer = buildReferer(base);
    let tokenData;

    try {
        tokenData = await requestServerToken(base, meta.tmdbId, referer);
    } catch (err) {
        console.warn(`[ZXCStreams] Token request failed on ${base}, trying fallback bases...`, err.message);
        invalidateBase();
        let found = false;
        for (const fallback of DIRECT_BASES) {
            if (fallback === base) continue;
            try {
                const testBase = fallback;
                const testReferer = buildReferer(testBase);
                tokenData = await requestServerToken(testBase, meta.tmdbId, testReferer);
                base = testBase;
                _base = testBase;
                _baseValidatedAt = Date.now();
                found = true;
                break;
            } catch (e) {
                // ignore
            }
        }
        if (!found) {
            console.error('[ZXCStreams] All fallback bases failed, giving up');
            return [];
        }
        referer = buildReferer(base);
    }

    const { serverToken, serverTs, xt } = tokenData;

    const params = {
        [F.id]: meta.tmdbId,
        b: type,
        [F.ts]: String(serverTs),
        [F.token]: serverToken,
        [F.fToken]: xt,
        [F.title]: meta.title,
        [F.year]: meta.year,
        date: meta.releaseDate,
        [F.imdbId]: meta.imdbId
    };
    if (season != null && episode != null) {
        params[F.season] = String(season);
        params[F.episode] = String(episode);
    }
    const qs = new URLSearchParams(params).toString();

    try {
        const response = await cloudscraper({
            method: 'GET',
            url: `${base}/backend_/servers/${server}?${qs}`,
            headers: { ...COMMON_HEADERS, Origin: base, Referer: referer },
            timeout: 5000,
            gzip: true,
            followRedirect: true,
        });
        const data = JSON.parse(response);
        if (!data.success || !Array.isArray(data.links)) return [];

        const requestHeaders = {
            Referer: referer,
            Origin: base,
            'User-Agent': COMMON_HEADERS['User-Agent']
        };

        return data.links
            .filter((l) => l.link)
            .map((l) => ({
                server,
                type: l.type || (l.link.includes('.m3u8') ? 'hls' : 'mp4'),
                resolution: l.resolution ?? (l.source && l.source !== 'default' ? l.source : undefined) ?? '?',
                size: l.size,
                url: l.link,
                requestHeaders
            }));
    } catch (err) {
        console.error(`[ZXCStreams] fetchServer error: ${err.message}`);
        return [];
    }
}

// ============================================
// Stream Aggregation
// ============================================

async function getAllStreams(type, meta, season, episode) {
    const serverPromises = SERVERS.map((s) =>
        fetchServer(s, meta, type, season, episode)
            .then(result => ({ server: s, result }))
            .catch(() => ({ server: s, result: [] }))
    );

    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve([]), 8000);
    });

    const results = await Promise.race([
        Promise.allSettled(serverPromises),
        timeoutPromise.then(() => [])
    ]);

    if (Array.isArray(results) && results.length === 0) {
        console.warn('[ZXCStreams] Server aggregation timed out after 8 seconds');
        return [];
    }

    const streams = [];
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value && r.value.result && Array.isArray(r.value.result)) {
            streams.push(...r.value.result);
        }
    }
    return streams;
}

// ============================================
// Quality Label Functions
// ============================================

function isValidQuality(quality) {
    if (!quality) return false;
    const q = String(quality);
    return /^(1080|720|480|360|4K|2160)p?$/i.test(q);
}

function isValidStream(stream) {
    if (!stream || !stream.url) return false;
    if (stream.url === 'null' || stream.url === 'undefined' || stream.url === '') return false;
    if (!isValidQuality(stream.quality)) return false;
    return true;
}

function resolutionLabel(server, res) {
    if (typeof res === 'number' && res <= 4) {
        return ['360p', '480p', '720p', '1080p', '4K'][res] ?? `q${res}`;
    }
    return typeof res === 'number' ? `${res}p` : String(res);
}

function formatSize(bytes) {
    if (!bytes) return '';
    const n = Number(bytes);
    if (!Number.isFinite(n)) return '';
    if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
    if (n > 1e6) return `${(n / 1e6).toFixed(0)} MB`;
    return `${(n / 1e3).toFixed(0)} KB`;
}

// ============================================
// Main Export Function
// ============================================

async function getZxcstreamsStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[ZXCStreams] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const startTime = Date.now();

    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbType = mediaType === 'tv' ? 'tv' : 'movie';
        const details = await getDetails(tmdbType, tmdbId);
        const title = (details && (details.title || details.name)) || '';
        if (!title) {
            console.log(`[ZXCStreams] No TMDB title resolved for ${tmdbId}`);
            return [];
        }
        const releaseDate = (details && (details.release_date || details.first_air_date || '').slice(0, 10)) || '';
        const year = (details && (details.release_date || details.first_air_date || '').slice(0, 4)) || '';
        const imdbId = await resolveImdbId(tmdbType, tmdbId);
        if (!imdbId || !imdbId.startsWith('tt')) {
            console.log(`[ZXCStreams] No IMDB ID resolved for TMDB ${tmdbId}`);
            return [];
        }

        const meta = {
            tmdbId: String(tmdbId),
            title,
            year,
            releaseDate,
            imdbId
        };

        const links = await getAllStreams(type, meta, seasonNum, episodeNum);
        if (!links.length) {
            console.log(`[ZXCStreams] No streams found for "${title}"`);
            return [];
        }

        const scored = links.map((l) => {
            const r = typeof l.resolution === 'number' ? l.resolution : 0;
            const height = r > 4 ? r : ([240, 480, 720, 1080, 2160][r] ?? 0);
            return { l, score: (l.type === 'mp4' ? 10000 : 0) + height };
        });
        scored.sort((a, b) => b.score - a.score);

        const streams = [];
        for (const { l } of scored) {
            const label = resolutionLabel(l.server, l.resolution);
            const size = formatSize(l.size);
            const kind = l.type === 'hls' ? 'HLS' : 'MP4';
            const serverName =
                l.server === 'icarus' ? 'Icarus' :
                l.server === 'orion' ? 'Orion' :
                l.server === 'athena' ? 'Athena' : 'Berkas';

            const streamObj = {
                name: `ZXCStreams ${serverName} ${label}`,
                title: `${serverName} • ${label} • ${kind}`,
                url: l.url,
                quality: label,
                provider: 'ZXCStreams',
                headers: {
                    'Referer': l.requestHeaders.Referer,
                    'Origin': l.requestHeaders.Origin,
                    'User-Agent': l.requestHeaders['User-Agent']
                }
            };

            if (isValidStream(streamObj)) {
                streams.push(streamObj);
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`[ZXCStreams] Got ${streams.length} valid stream(s) for "${title}" in ${elapsed}ms`);
        return streams;
    } catch (err) {
        console.error(`[ZXCStreams] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams: getZxcstreamsStreams };