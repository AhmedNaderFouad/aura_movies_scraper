// src/providers/vixsrc.js
// VixSrc Provider - Extracts HLS streams from vixsrc.to
// Supports multiple audio tracks and subtitles with full language detection
// Part of AuraMovies local scrapers collection
// ✅ Added proxy support for Vercel deployment

const axios = require('axios');

// ============================================
// Configuration
// ============================================

const BASE_URL = 'https://vixsrc.to';
const VIXSRC_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
// Proxy Detection
// ============================================

// Detect if running on Vercel (Serverless)
const IS_VERCEL = process.env.VERCEL === '1' || process.env.NOW_REGION !== undefined;

// Proxy function – wraps URL with proxy service
function getProxiedUrl(url) {
    if (IS_VERCEL) {
        // Using allorigins.win as a free proxy to avoid IP blocking
        // This returns the raw content of the target URL
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    }
    return url;
}

// ============================================
// Language Mapping (Full Support)
// ============================================

const LANGUAGE_MAP = {
    'en': 'English',
    'eng': 'English',
    'english': 'English',
    'ar': 'Arabic',
    'ara': 'Arabic',
    'arabic': 'Arabic',
    'es': 'Spanish',
    'spa': 'Spanish',
    'spanish': 'Spanish',
    'español': 'Spanish',
    'latino': 'Spanish (Latino)',
    'it': 'Italian',
    'ita': 'Italian',
    'italian': 'Italian',
    'italiano': 'Italian',
    'fr': 'French',
    'fra': 'French',
    'french': 'French',
    'francais': 'French',
    'française': 'French',
    'de': 'German',
    'deu': 'German',
    'german': 'German',
    'deutsch': 'German',
    'pt': 'Portuguese',
    'por': 'Portuguese',
    'portuguese': 'Portuguese',
    'português': 'Portuguese',
    'ru': 'Russian',
    'rus': 'Russian',
    'russian': 'Russian',
    'русский': 'Russian',
    'ja': 'Japanese',
    'jpn': 'Japanese',
    'japanese': 'Japanese',
    '日本語': 'Japanese',
    'ko': 'Korean',
    'kor': 'Korean',
    'korean': 'Korean',
    '한국어': 'Korean',
    'zh': 'Chinese',
    'zho': 'Chinese',
    'chinese': 'Chinese',
    '中文': 'Chinese',
    'hi': 'Hindi',
    'hin': 'Hindi',
    'hindi': 'Hindi',
    'हिन्दी': 'Hindi',
    'tr': 'Turkish',
    'tur': 'Turkish',
    'turkish': 'Turkish',
    'türkçe': 'Turkish',
    'nl': 'Dutch',
    'nld': 'Dutch',
    'dutch': 'Dutch',
    'nederlands': 'Dutch',
    'pl': 'Polish',
    'pol': 'Polish',
    'polish': 'Polish',
    'polski': 'Polish',
    'sv': 'Swedish',
    'swe': 'Swedish',
    'swedish': 'Swedish',
    'svenska': 'Swedish',
    'da': 'Danish',
    'dan': 'Danish',
    'danish': 'Danish',
    'dansk': 'Danish',
    'fi': 'Finnish',
    'fin': 'Finnish',
    'finnish': 'Finnish',
    'suomi': 'Finnish',
    'no': 'Norwegian',
    'nor': 'Norwegian',
    'norwegian': 'Norwegian',
    'norsk': 'Norwegian',
    'el': 'Greek',
    'ell': 'Greek',
    'greek': 'Greek',
    'ελληνικά': 'Greek',
    'he': 'Hebrew',
    'heb': 'Hebrew',
    'hebrew': 'Hebrew',
    'עברית': 'Hebrew',
    'th': 'Thai',
    'tha': 'Thai',
    'thai': 'Thai',
    'ไทย': 'Thai',
    'vi': 'Vietnamese',
    'vie': 'Vietnamese',
    'vietnamese': 'Vietnamese',
    'Tiếng Việt': 'Vietnamese',
    'id': 'Indonesian',
    'ind': 'Indonesian',
    'indonesian': 'Indonesian',
    'bahasa indonesia': 'Indonesian',
    'ms': 'Malay',
    'msa': 'Malay',
    'malay': 'Malay',
    'bahasa melayu': 'Malay',
};

/**
 * Get full language name from code or label
 * @param {string} langCode - Language code or label
 * @returns {string} Full language name
 */
function getLanguageName(langCode) {
    if (!langCode) return 'Unknown';
    const lower = langCode.toLowerCase().trim();
    return LANGUAGE_MAP[lower] || langCode;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Detect all available languages from playlist content
 * @param {string} playlistContent - HLS playlist content
 * @returns {Array} Array of detected language objects
 */
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

/**
 * Detect available languages from playlist content (legacy)
 * @param {string} playlistContent - HLS playlist content
 * @returns {string} Detected language code
 */
function detectLanguageFromPlaylist(playlistContent) {
    if (!playlistContent) return 'unknown';

    const languages = detectAllLanguages(playlistContent);

    if (languages.length === 0) return 'unknown';

    // Check for English first
    const english = languages.find(l => l.code === 'en' || l.code === 'eng');
    if (english) return 'en';

    // Return first available language
    return languages[0].code;
}

/**
 * Extract all audio tracks from playlist (no language filtering)
 * @param {string} playlistContent - HLS playlist content
 * @returns {Array} Array of audio track objects
 */
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
// API Request Functions (with Proxy)
// ============================================

async function fetchApi(url) {
    const proxiedUrl = getProxiedUrl(url);
    console.log(`[Vixsrc] Fetching API: ${IS_VERCEL ? 'via Proxy' : 'direct'} - ${url}`);
    try {
        const response = await axios.get(proxiedUrl, {
            headers: VIXSRC_HEADERS,
            timeout: 15000 // Increased timeout for proxy
        });
        if (response.status !== 200 || !response.data) return null;
        return response.data;
    } catch (error) {
        console.error(`[Vixsrc] API fetch error: ${error.message}`);
        // If proxy fails, fallback to direct request (only if not on Vercel)
        if (IS_VERCEL) {
            console.log('[Vixsrc] Proxy failed, trying direct (might be blocked)...');
            try {
                const directResponse = await axios.get(url, {
                    headers: VIXSRC_HEADERS,
                    timeout: 10000
                });
                if (directResponse.status === 200 && directResponse.data) {
                    return directResponse.data;
                }
            } catch (e) {
                console.error('[Vixsrc] Direct fallback also failed:', e.message);
            }
        }
        return null;
    }
}

async function fetchEmbedPage(suburl) {
    const fullUrl = BASE_URL + suburl;
    const proxiedUrl = getProxiedUrl(fullUrl);
    console.log(`[Vixsrc] Fetching Embed: ${IS_VERCEL ? 'via Proxy' : 'direct'} - ${fullUrl}`);
    try {
        const response = await axios.get(proxiedUrl, {
            headers: { ...VIXSRC_HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' },
            timeout: 15000,
            responseType: 'text'
        });
        if (response.status !== 200) return null;
        return response.data;
    } catch (error) {
        console.error(`[Vixsrc] Embed fetch error: ${error.message}`);
        // Fallback to direct
        if (IS_VERCEL) {
            console.log('[Vixsrc] Proxy failed, trying direct embed...');
            try {
                const directResponse = await axios.get(fullUrl, {
                    headers: { ...VIXSRC_HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' },
                    timeout: 10000,
                    responseType: 'text'
                });
                if (directResponse.status === 200) return directResponse.data;
            } catch (e) {
                console.error('[Vixsrc] Direct embed fallback failed:', e.message);
            }
        }
        return null;
    }
}

// ============================================
// Token Extraction & Playlist Processing
// ============================================

function extractTokenData(html) {
    const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
    const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
    const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];

    if (!token || !expires || !playlist) return null;

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
    const sources = [];
    const subtitles = [];
    const allAudioTracks = [];

    const lines = content.split('\n');

    // Extract all audio tracks with full metadata
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

    // Extract subtitles
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

    //  DEDUPLICATE AUDIO TRACKS - keep only one per language (prefer default)
    const uniqueAudioTracksMap = new Map();
    for (const track of allAudioTracks) {
        const langKey = track.language.toLowerCase();
        if (!uniqueAudioTracksMap.has(langKey)) {
            uniqueAudioTracksMap.set(langKey, track);
        } else {
            const existing = uniqueAudioTracksMap.get(langKey);
            // If this track is default and existing is not, replace
            if (track.isDefault && !existing.isDefault) {
                uniqueAudioTracksMap.set(langKey, track);
            }
        }
    }
    const uniqueAudioTracks = Array.from(uniqueAudioTracksMap.values());

    // Extract best resolution
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

    // Sort audio tracks: English first, then others, then default
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
        audioTracks: sortedAudioTracks, // Deduplicated tracks with full metadata
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
// Main Stream Function (exported)
// ============================================

/**
 * Fetch streams from VixSrc
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} seasonNum - Season number (tv only)
 * @param {number} episodeNum - Episode number (tv only)
 * @returns {Promise<Array>} Array of stream objects
 */
async function getStreams(tmdbId, mediaType = 'movie', seasonNum = 1, episodeNum = 1) {
    console.log(`[Vixsrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    console.log(`[Vixsrc] Running on ${IS_VERCEL ? 'Vercel (Proxy enabled)' : 'Localhost (Direct)'}`);

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
        // For playlist, we also use proxy if on Vercel
        const playlistProxyUrl = getProxiedUrl(masterUrl);
        const playlistResponse = await axios.get(playlistProxyUrl, {
            headers: { ...VIXSRC_HEADERS, Referer: apiUrl },
            timeout: 15000,
            responseType: 'text'
        });
        playlistContent = playlistResponse.data;
    } catch (e) {
        console.log(`[Vixsrc] Could not fetch playlist content: ${e.message}`);
        // Fallback direct
        if (IS_VERCEL) {
            try {
                const directPlaylist = await axios.get(masterUrl, {
                    headers: { ...VIXSRC_HEADERS, Referer: apiUrl },
                    timeout: 10000,
                    responseType: 'text'
                });
                playlistContent = directPlaylist.data;
            } catch (e2) {
                console.log(`[Vixsrc] Direct playlist fallback failed: ${e2.message}`);
            }
        }
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
        // Add English track indicator for easy access
        hasEnglishAudio: audioTracks.some(t =>
            t.language === 'en' || t.language === 'eng' || t.language === 'english'
        ),
        // Add default track indicator
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