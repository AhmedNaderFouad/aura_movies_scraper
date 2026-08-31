// src/providers/vixsrc.js
// VixSrc Provider - Extracts HLS streams from vixsrc.to
// ✅ Fixed: data.match is not a function (ensures HTML is always string)
// ✅ Enhanced with multiple proxies, retries, user-agent rotation

const axios = require('axios');

// ============================================
// Configuration
// ============================================

const BASE_URL = 'https://vixsrc.to';
const IS_VERCEL = process.env.VERCEL === '1' || process.env.NOW_REGION !== undefined;

// قائمة بـ User-Agents للتناوب
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];
let uaIndex = 0;

function getNextUserAgent() {
    return USER_AGENTS[uaIndex++ % USER_AGENTS.length];
}

// قائمة بـ Proxies (مجانية)
const PROXY_SERVICES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://proxy.cors.sh/${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`,
];

// Headers الأساسية
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
// Simple Retry Logic (بدون axios-retry)
// ============================================

async function fetchWithRetry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < retries - 1) {
                console.log(`[Vixsrc] Retry ${i + 1}/${retries} after error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
    }
    throw lastError;
}

// ============================================
// Language Mapping (Full Support)
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
// Utility Functions
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
                uri: uri,
                isDefault: isDefault,
                isForced: isForced,
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

function extractAudioTracks(playlistContent) {
    if (!playlistContent) return [];
    const audioTracks = [];
    const audioTrackRegex = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*/gi;
    let match;
    while ((match = audioTrackRegex.exec(playlistContent)) !== null) {
        const block = match[0];
        const language = block.match(/LANGUAGE="([^"]+)"/)?.[1] || 'unknown';
        const label = block.match(/NAME="([^"]+)"/)?.[1] || 'Audio';
        const uri = block.match(/URI="([^"]+)"/)?.[1] || null;
        const isDefault = block.includes('DEFAULT=YES') || block.includes('DEFAULT=1');
        const isForced = block.includes('FORCED=YES') || block.includes('FORCED=1');
        const channels = block.match(/CHANNELS="([^"]+)"/)?.[1] || null;
        audioTracks.push({
            language: language,
            label: label,
            name: getLanguageName(language),
            uri: uri,
            isDefault: isDefault,
            isForced: isForced,
            channels: channels,
            type: 'audio'
        });
    }
    return audioTracks;
}

// ============================================
// Core Fetch Functions (with manual retry)
// ============================================

async function fetchWithProxy(url, proxyFn, headers, responseType = 'text', timeout = 15000) {
    const proxyUrl = proxyFn(url);
    console.log(`[Vixsrc] Trying proxy: ${proxyUrl.substring(0, 60)}...`);
    try {
        const response = await axios.get(proxyUrl, {
            headers: { ...headers, 'User-Agent': getNextUserAgent() },
            timeout: timeout,
            responseType: responseType,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        if (response.status === 200 && response.data) {
            console.log(`[Vixsrc] Proxy succeeded.`);
            return response.data;
        }
    } catch (error) {
        console.log(`[Vixsrc] Proxy failed: ${error.message}`);
    }
    return null;
}

async function fetchDirect(url, headers, responseType = 'text', timeout = 10000) {
    console.log(`[Vixsrc] Trying direct: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: { ...headers, 'User-Agent': getNextUserAgent() },
            timeout: timeout,
            responseType: responseType,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
        });
        if (response.status === 200 && response.data) {
            console.log(`[Vixsrc] Direct succeeded.`);
            return response.data;
        }
    } catch (error) {
        console.log(`[Vixsrc] Direct failed: ${error.message}`);
    }
    return null;
}

// الدالة الرئيسية للجلب مع محاولات متعددة يدوية
async function fetchWithFallback(url, options = {}) {
    const { isJson = false, isHtml = false, timeout = 15000 } = options;
    const headers = { ...VIXSRC_HEADERS };
    let responseType = 'text';
    if (isJson) {
        responseType = 'json';
    } else if (isHtml) {
        responseType = 'text';
    }

    // 1. حاول مباشرة مع retry يدوي
    try {
        const result = await fetchWithRetry(async () => {
            return await fetchDirect(url, headers, responseType, timeout);
        }, 3, 1000);
        if (result) {
            if (isJson && typeof result === 'string') {
                try { return JSON.parse(result); } catch {}
            }
            return result;
        }
    } catch (e) {
        console.log(`[Vixsrc] Direct with retry failed: ${e.message}`);
    }

    // 2. جرب جميع الـ Proxies
    for (const proxyFn of PROXY_SERVICES) {
        try {
            const result = await fetchWithRetry(async () => {
                return await fetchWithProxy(url, proxyFn, headers, responseType, timeout);
            }, 2, 800);
            if (result) {
                if (isJson && typeof result === 'string') {
                    try { return JSON.parse(result); } catch {}
                }
                return result;
            }
        } catch (e) {
            console.log(`[Vixsrc] Proxy retry failed: ${e.message}`);
        }
    }

    // 3. استخدام Puppeteer (اختياري)
    try {
        const puppeteer = require('puppeteer-core');
        const chromium = require('chrome-aws-lambda');
        console.log('[Vixsrc] Trying Puppeteer...');
        let browser = null;
        try {
            browser = await puppeteer.launch({
                args: chromium.args,
                executablePath: await chromium.executablePath,
                headless: true,
            });
            const page = await browser.newPage();
            await page.setUserAgent(getNextUserAgent());
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
            const content = await page.content();
            await browser.close();
            console.log('[Vixsrc] Puppeteer succeeded.');
            if (isJson) {
                const jsonMatch = content.match(/{.*}/s);
                if (jsonMatch) {
                    try { return JSON.parse(jsonMatch[0]); } catch {}
                }
                return null;
            }
            return content;
        } catch (e) {
            if (browser) await browser.close();
            console.log(`[Vixsrc] Puppeteer failed: ${e.message}`);
        }
    } catch (e) {
        console.log('[Vixsrc] Puppeteer not available.');
    }

    console.log('[Vixsrc] All fetch methods failed.');
    return null;
}

// ============================================
// API Request Functions
// ============================================

async function fetchApi(url) {
    console.log(`[Vixsrc] Fetching API: ${url}`);
    const data = await fetchWithFallback(url, { isJson: true, timeout: 15000 });
    return data || null;
}

// ✅ الأهم: تأكد من أن fetchEmbedPage ترجع نصاً دائماً
async function fetchEmbedPage(suburl) {
    const fullUrl = BASE_URL + suburl;
    console.log(`[Vixsrc] Fetching Embed: ${fullUrl}`);
    // طلب HTML كنص
    const data = await fetchWithFallback(fullUrl, { isHtml: true, timeout: 15000 });
    // تأكد من أن القيمة المعادة هي نص أو null
    if (typeof data === 'string') {
        return data;
    }
    if (data && typeof data === 'object') {
        // إذا كان كائناً (مثل خطأ) حوّله إلى نص
        return JSON.stringify(data);
    }
    // أي شيء آخر → null
    return null;
}

// ============================================
// Token Extraction & Playlist Processing
// ============================================

// ✅ تأكد من أن extractTokenData تستقبل نصاً
function extractTokenData(html) {
    // إذا لم يكن html نصاً، حاول تحويله
    if (typeof html !== 'string') {
        console.log('[Vixsrc] extractTokenData: input is not string, converting...');
        if (html && typeof html === 'object') {
            html = JSON.stringify(html);
        } else {
            html = String(html);
        }
    }
    const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
    const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
    const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];
    if (!token || !expires || !playlist) {
        console.log('[Vixsrc] Could not extract token/expires/playlist from HTML');
        return null;
    }
    if (parseInt(expires, 10) * 1000 - 60_000 < Date.now()) {
        console.log('[Vixsrc] Token is expired');
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
    // تأكد من أن content نص
    if (typeof content !== 'string' || !content) {
        console.log('[Vixsrc] parsePlaylist: content is not string or empty');
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
            language: language,
            label: label,
            name: getLanguageName(language),
            uri: uri,
            isDefault: isDefault,
            isForced: isForced,
            channels: channels,
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
            url: url,
            label: label,
            language: language,
            name: getLanguageName(language),
            isDefault: isDefault,
            isForced: isForced,
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
        subtitles: subtitles,
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
// Main Stream Function
// ============================================

async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Vixsrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    console.log(`[Vixsrc] Running on ${IS_VERCEL ? 'Vercel (with fallbacks)' : 'Localhost'}`);

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
    console.log(`[Vixsrc] Step 3 - Master URL: ${masterUrl}`);

    let playlistContent = '';
    try {
        const playlistData = await fetchWithFallback(masterUrl, { isHtml: false, timeout: 15000 });
        if (playlistData && typeof playlistData === 'string') {
            playlistContent = playlistData;
        } else if (playlistData && typeof playlistData === 'object') {
            console.log('[Vixsrc] Playlist data is object, converting to string');
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
        audioTracks: audioTracks,
        subtitles: subtitles,
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