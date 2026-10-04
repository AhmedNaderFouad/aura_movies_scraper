// src/providers/vixsrc.js
// ✅ Cloudscraper-based version — works on Vercel/Codespaces without IP blocks

const cloudscraper = require('cloudscraper');

// ============================================
// Configuration
// ============================================

const BASE_URL = 'https://vixsrc.to';
const IS_VERCEL =
    process.env.VERCEL === '1' ||
    process.env.NOW_REGION !== undefined ||
    process.env.CODESPACES === 'true';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
];
let uaIndex = 0;
function getNextUserAgent() {
    return USER_AGENTS[uaIndex++ % USER_AGENTS.length];
}

// Proxies كاحتياطي لو cloudscraper فشل (نادراً)
const PROXY_SERVICES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

const VIXSRC_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://vixsrc.to/',
    'Origin': 'https://vixsrc.to',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive'
};

// ============================================
// Language Mapping (كما هو)
// ============================================

const LANGUAGE_MAP = {
    'en': 'English', 'eng': 'English', 'english': 'English',
    'ar': 'Arabic', 'ara': 'Arabic', 'arabic': 'Arabic',
    'es': 'Spanish', 'spa': 'Spanish', 'spanish': 'Spanish',
    'español': 'Spanish', 'latino': 'Spanish (Latino)',
    'it': 'Italian', 'ita': 'Italian', 'italian': 'Italian',
    'italiano': 'Italian', 'fr': 'French', 'fra': 'French',
    'french': 'French', 'francais': 'French', 'française': 'French',
    'de': 'German', 'deu': 'German', 'german': 'German',
    'deutsch': 'German', 'pt': 'Portuguese', 'por': 'Portuguese',
    'portuguese': 'Portuguese', 'português': 'Portuguese',
    'ru': 'Russian', 'rus': 'Russian', 'russian': 'Russian',
    'русский': 'Russian', 'ja': 'Japanese', 'jpn': 'Japanese',
    'japanese': 'Japanese', '日本語': 'Japanese',
    'ko': 'Korean', 'kor': 'Korean', 'korean': 'Korean',
    '한국어': 'Korean', 'zh': 'Chinese', 'zho': 'Chinese',
    'chinese': 'Chinese', '中文': 'Chinese',
    'hi': 'Hindi', 'hin': 'Hindi', 'hindi': 'Hindi',
    'हिन्दी': 'Hindi', 'tr': 'Turkish', 'tur': 'Turkish',
    'turkish': 'Turkish', 'türkçe': 'Turkish',
    'nl': 'Dutch', 'nld': 'Dutch', 'dutch': 'Dutch',
    'nederlands': 'Dutch', 'pl': 'Polish', 'pol': 'Polish',
    'polish': 'Polish', 'polski': 'Polish',
    'sv': 'Swedish', 'swe': 'Swedish', 'swedish': 'Swedish',
    'svenska': 'Swedish', 'da': 'Danish', 'dan': 'Danish',
    'danish': 'Danish', 'dansk': 'Danish',
    'fi': 'Finnish', 'fin': 'Finnish', 'finnish': 'Finnish',
    'suomi': 'Finnish', 'no': 'Norwegian', 'nor': 'Norwegian',
    'norwegian': 'Norwegian', 'norsk': 'Norwegian',
    'el': 'Greek', 'ell': 'Greek', 'greek': 'Greek',
    'ελληνικά': 'Greek', 'he': 'Hebrew', 'heb': 'Hebrew',
    'hebrew': 'Hebrew', 'עברית': 'Hebrew',
    'th': 'Thai', 'tha': 'Thai', 'thai': 'Thai',
    'ไทย': 'Thai', 'vi': 'Vietnamese', 'vie': 'Vietnamese',
    'vietnamese': 'Vietnamese', 'Tiếng Việt': 'Vietnamese',
    'id': 'Indonesian', 'ind': 'Indonesian', 'indonesian': 'Indonesian',
    'bahasa indonesia': 'Indonesian',
    'ms': 'Malay', 'msa': 'Malay', 'malay': 'Malay',
    'bahasa melayu': 'Malay',
};

function getLanguageName(langCode) {
    if (!langCode) return 'Unknown';
    const lower = langCode.toLowerCase().trim();
    return LANGUAGE_MAP[lower] || langCode;
}

// ============================================
// Utility Functions (كما هو)
// ============================================

function detectAllLanguages(playlistContent) {
    if (!playlistContent) return [];
    const languages = [];
    const audioTrackRegex = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/gi;
    let match;
    while ((match = audioTrackRegex.exec(playlistContent)) !== null) {
        const block = match[0];
        const langCode = block.match(/LANGUAGE="([^"]+)"/)?.[1] || null;
        const label = block.match(/NAME="([^"]+)"/)?.[1] || null;
        const uri = block.match(/URI="([^"]+)"/)?.[1] || null;
        const isDefault = block.includes('DEFAULT=YES') || block.includes('DEFAULT=1');
        const isForced = block.includes('FORCED=YES') || block.includes('FORCED=1');
        if (langCode) {
            languages.push({
                code: langCode,
                label: label || getLanguageName(langCode),
                name: getLanguageName(langCode),
                uri,
                isDefault,
                isForced,
                type: 'audio'
            });
        }
    }
    return languages;
}

function detectLanguageFromPlaylist(playlistContent) {
    if (!playlistContent) return 'unknown';
    const languages = detectAllLanguages(playlistContent);
    if (languages.length === 0) return 'unknown';
    const english = languages.find(l => l.code === 'en' || l.code === 'eng');
    if (english) return 'en';
    return languages[0].code;
}

// ============================================
// 🔥 Core Fetcher — cloudscraper (البديل الجديد لـ axios)
// ============================================

/**
 * طلب HTTP باستخدام cloudscraper (يتخطى Cloudflare وحمايات البوت).
 * @param {string} url
 * @param {object} options { method, headers, body, timeout, isJson, retries }
 * @returns {Promise<string|object|null>}
 */
async function cloudscraperRequest(url, options = {}) {
    const {
        method = 'GET',
        headers = {},
        body = null,
        timeout = 20000,
        isJson = false,
        retries = 2,
    } = options;

    const finalHeaders = {
        ...VIXSRC_HEADERS,
        ...headers,
        'User-Agent': headers['User-Agent'] || getNextUserAgent(),
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            console.log(`[Vixsrc] ${method} attempt ${attempt + 1}: ${url.substring(0, 80)}...`);

            const response = await cloudscraper({
                method,
                url,
                headers: finalHeaders,
                body: body || undefined,
                timeout,
                gzip: true,
                followRedirect: true,
                retries: 0, // إحنا اللي بندير الـ retries
            });

            if (!response) {
                console.log(`[Vixsrc] Empty response on attempt ${attempt + 1}`);
                continue;
            }

            // cloudscraper بيرجع string
            if (isJson) {
                try {
                    return JSON.parse(response);
                } catch {
                    // أحياناً الـ JSON بيكون مغلف في HTML
                    const jsonMatch = response.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try { return JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
                    }
                    console.log('[Vixsrc] Failed to parse JSON response');
                    return null;
                }
            }

            console.log(`[Vixsrc] ✅ Success (${response.length} bytes)`);
            return response;
        } catch (err) {
            console.log(`[Vixsrc] Attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
            }
        }
    }

    // احتياطي أخير: proxify
    console.log('[Vixsrc] cloudscraper failed, trying proxies as last resort...');
    for (const proxyFn of PROXY_SERVICES) {
        try {
            const proxyUrl = proxyFn(url);
            const response = await cloudscraper({
                method: 'GET',
                url: proxyUrl,
                headers: { 'User-Agent': getNextUserAgent() },
                timeout,
                gzip: true,
                followRedirect: true,
            });
            if (response) {
                if (isJson) {
                    try { return JSON.parse(response); } catch { /* fallthrough */ }
                } else {
                    return response;
                }
            }
        } catch (e) {
            console.log(`[Vixsrc] Proxy fallback failed: ${e.message}`);
        }
    }

    return null;
}

// ============================================
// API Request Functions (نفس المنطق، بس بـ cloudscraper)
// ============================================

async function fetchApi(url) {
    console.log(`[Vixsrc] Fetching API: ${url}`);
    const data = await cloudscraperRequest(url, {
        isJson: true,
        timeout: 20000,
        retries: 2,
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Referer': `${BASE_URL}/`,
        },
    });
    return data || null;
}

async function fetchEmbedPage(suburl) {
    const fullUrl = BASE_URL + suburl;
    console.log(`[Vixsrc] Fetching Embed: ${fullUrl}`);
    const data = await cloudscraperRequest(fullUrl, {
        isJson: false,
        timeout: 20000,
        retries: 2,
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': `${BASE_URL}/`,
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
        },
    });
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') return JSON.stringify(data);
    return null;
}

// ============================================
// Token Extraction & Playlist Processing (كما هو)
// ============================================

function extractTokenData(html) {
    if (typeof html !== 'string') {
        if (html && typeof html === 'object') html = JSON.stringify(html);
        else html = String(html);
    }
    const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
    const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
    const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];
    if (!token || !expires || !playlist) return null;
    if (parseInt(expires, 10) * 1000 - 60000 < Date.now()) {
        console.log('[Vixsrc] Token expired');
        return null;
    }
    return { token, expires, playlist };
}

function buildMasterUrl(tokenData) {
    const { token, expires, playlist } = tokenData;
    const sep = playlist.includes('?') ? '&' : '?';
    return `${playlist}${sep}token=${token}&expires=${expires}&h=1`;
}

function parsePlaylist(content, masterUrl, pageApiUrl) {
    if (typeof content !== 'string' || !content) {
        return { sources: [], subtitles: [], audioTracks: [] };
    }
    const sources = [];
    const subtitles = [];
    const allAudioTracks = [];

    const lines = content.split('\n');

    for (const line of lines) {
        if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) continue;
        const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] || 'unknown';
        const label = line.match(/NAME="([^"]+)"/)?.[1] || 'Audio';
        const uri = line.match(/URI="([^"]+)"/)?.[1] || null;
        const isDefault = line.includes('DEFAULT=YES') || line.includes('DEFAULT=1');
        const isForced = line.includes('FORCED=YES') || line.includes('FORCED=1');
        const channels = line.match(/CHANNELS="([^"]+)"/)?.[1] || null;
        allAudioTracks.push({
            language, label,
            name: getLanguageName(language),
            uri, isDefault, isForced, channels,
            type: 'audio'
        });
    }

    for (const line of lines) {
        if (!line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) continue;
        const url = line.match(/URI="([^"]+)"/)?.[1];
        if (!url) continue;
        const label = line.match(/NAME="([^"]+)"/)?.[1] ?? 'unknown';
        const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? 'unknown';
        const isDefault = line.includes('DEFAULT=YES') || line.includes('DEFAULT=1');
        const isForced = line.includes('FORCED=YES') || line.includes('FORCED=1');
        subtitles.push({
            url, label, language,
            name: getLanguageName(language),
            isDefault, isForced,
            format: 'vtt',
            type: 'subtitle'
        });
    }

    const uniqueAudioTracksMap = new Map();
    for (const track of allAudioTracks) {
        const langKey = track.language.toLowerCase();
        if (!uniqueAudioTracksMap.has(langKey)) {
            uniqueAudioTracksMap.set(langKey, track);
        } else {
            const existing = uniqueAudioTracksMap.get(langKey);
            if (track.isDefault && !existing.isDefault) {
                uniqueAudioTracksMap.set(langKey, track);
            }
        }
    }
    const uniqueAudioTracks = Array.from(uniqueAudioTracksMap.values());

    const variantRegex = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;
    let match;
    let bestResolution = 0;
    while ((match = variantRegex.exec(content)) !== null) {
        const res = parseInt(match[1], 10);
        if (res > bestResolution) bestResolution = res;
    }

    if (bestResolution === 0) return { sources: [], subtitles: [], audioTracks: [] };

    const detectedLang = detectLanguageFromPlaylist(content);
    const languages = detectAllLanguages(content);

    console.log(`[Vixsrc] Detected languages: ${languages.map(l => `${l.name} (${l.code})`).join(', ')}`);
    console.log(`[Vixsrc] Available audio tracks (unique): ${uniqueAudioTracks.length} (${allAudioTracks.length} total before dedup)`);
    console.log(`[Vixsrc] Available subtitles: ${subtitles.length}`);

    const sortedAudioTracks = [...uniqueAudioTracks].sort((a, b) => {
        if (a.language === 'en' || a.language === 'eng') return -1;
        if (b.language === 'en' || b.language === 'eng') return 1;
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return 0;
    });

    sources.push({
        name: `Vixsrc - ${bestResolution}p`,
        title: `Vixsrc - ${bestResolution}p`,
        url: masterUrl,
        quality: `${bestResolution}p`,
        provider: 'vixsrc',
        language: detectedLang,
        audioTracks: sortedAudioTracks,
        subtitles,
        hasAudioTracks: sortedAudioTracks.length > 0,
        hasSubtitles: subtitles.length > 0,
        headers: {
            'Referer': pageApiUrl,
            'User-Agent': VIXSRC_HEADERS['User-Agent']
        }
    });

    return { sources, subtitles, audioTracks: sortedAudioTracks };
}

// ============================================
// Main Stream Function (كما هو)
// ============================================

async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Vixsrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    console.log(`[Vixsrc] Running on ${IS_VERCEL ? 'Vercel/Codespaces' : 'Localhost'} (cloudscraper mode)`);

    let apiUrl;
    if (mediaType === 'movie') {
        apiUrl = `${BASE_URL}/api/movie/${tmdbId}`;
    } else {
        apiUrl = `${BASE_URL}/api/tv/${tmdbId}/${seasonNum}/${episodeNum}`;
    }

    console.log(`[Vixsrc] Step 1 - Calling API: ${apiUrl}`);
    const apiData = await fetchApi(apiUrl);
    if (!apiData || !apiData.src) {
        console.log('[Vixsrc] No src returned from API');
        return [];
    }

    console.log(`[Vixsrc] Step 2 - Fetching embed page: ${BASE_URL}${apiData.src}`);
    const html = await fetchEmbedPage(apiData.src);
    if (!html) {
        console.log('[Vixsrc] Failed to fetch embed page');
        return [];
    }

    const tokenData = extractTokenData(html);
    if (!tokenData) {
        console.log('[Vixsrc] Could not extract token/expires/playlist from embed HTML');
        return [];
    }

    const masterUrl = buildMasterUrl(tokenData);
    console.log(`[Vixsrc] Step 3 - Master URL: ${masterUrl.substring(0, 120)}...`);

    let playlistContent = '';
    try {
        const playlistData = await cloudscraperRequest(masterUrl, {
            isJson: false,
            timeout: 20000,
            retries: 2,
            headers: {
                'Accept': '*/*',
                'Referer': `${BASE_URL}/`,
            },
        });
        if (playlistData && typeof playlistData === 'string') {
            playlistContent = playlistData;
        } else if (playlistData && typeof playlistData === 'object') {
            playlistContent = JSON.stringify(playlistData);
        }
    } catch (e) {
        console.log(`[Vixsrc] Could not fetch playlist content: ${e.message}`);
    }

    const { sources, subtitles, audioTracks } = parsePlaylist(playlistContent, masterUrl, apiUrl);

    if (sources.length === 0) {
        console.log('[Vixsrc] No streams found in HLS playlist');
        return [];
    }

    const finalSources = sources.map(source => ({
        ...source,
        audioTracks,
        subtitles,
        hasAudioTracks: audioTracks.length > 0,
        hasSubtitles: subtitles.length > 0,
        hasEnglishAudio: audioTracks.some(t =>
            t.language === 'en' || t.language === 'eng' || t.language === 'english'
        ),
        hasDefaultAudio: audioTracks.some(t => t.isDefault === true)
    }));

    console.log(`[Vixsrc] Successfully extracted ${finalSources.length} stream(s).`);
    console.log(`[Vixsrc] Audio tracks (unique): ${audioTracks.length}, Subtitles: ${subtitles.length}`);
    console.log(`[Vixsrc] Languages: ${audioTracks.map(t => t.name).join(', ')}`);

    return finalSources;
}

// ============================================
// Export
// ============================================

module.exports = {
    getStreams,
    scrape: getStreams
};