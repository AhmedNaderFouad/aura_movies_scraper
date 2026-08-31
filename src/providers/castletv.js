const { createDecipheriv } = require('crypto');
const { getDetails } = require('../utils/tmdb');
const axios = require('axios');

const CASTLE_BASE = 'https://api.hlowb.com';
const PKG = 'com.external.castle';
const CHANNEL = 'IndiaA';
const CLIENT = '1';
const LANG = 'en-US';

const API_HEADERS = {
    'User-Agent': 'okhttp/4.9.3',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'Keep-Alive',
    'Referer': CASTLE_BASE
};

const PLAYBACK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    'DNT': '1'
};

// ============================================
// دوال التشفير الأساسية (نفسها)
// ============================================

function castleSafeParse(text) {
    const safe = text.replace(/([:{[,]\s*)(\d{16,})/g, '$1"$2"');
    return JSON.parse(safe);
}

function deriveKey(securityKey) {
    const keyBytes = Buffer.from(securityKey, 'base64');
    const suffix = Buffer.from('T!BgJB', 'utf8');
    const combined = Buffer.concat([keyBytes, suffix]);
    if (combined.length < 16) {
        return Buffer.concat([combined, Buffer.alloc(16 - combined.length, 0)]);
    }
    return combined.subarray(0, 16);
}

function decryptCastle(cipherText, securityKey) {
    const key = deriveKey(securityKey);
    const decipher = createDecipheriv('aes-128-cbc', key, key);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(cipherText, 'base64')),
        decipher.final()
    ]);
    return decrypted.toString('utf8');
}

async function castleRequest(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { ...API_HEADERS, ...(options.headers || {}) },
        signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
        throw new Error(`[CastleTV] HTTP ${res.status}: ${res.statusText}`);
    }
    return res;
}

async function extractCipher(res) {
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error('[CastleTV] Empty response body');
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed.data && typeof parsed.data === 'string') {
            return parsed.data.trim();
        }
    } catch {
        // Not JSON — raw cipher text
    }
    return trimmed;
}

function unwrap(obj) {
    if (obj && obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
        return obj.data;
    }
    return obj;
}

async function getSecurityKey() {
    const url = `${CASTLE_BASE}/v0.1/system/getSecurityKey/1?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}`;
    const res = await castleRequest(url);
    const json = await res.json();
    if (json.code !== 200 || !json.data) {
        throw new Error(`[CastleTV] Security key error: ${JSON.stringify(json)}`);
    }
    return json.data;
}

async function searchCastle(secKey, keyword) {
    const params = new URLSearchParams({
        channel: CHANNEL,
        clientType: CLIENT,
        keyword,
        lang: LANG,
        mode: '1',
        packageName: PKG,
        page: '1',
        size: '30'
    });
    const res = await castleRequest(`${CASTLE_BASE}/film-api/v1.1.0/movie/searchByKeyword?${params}`);
    const cipher = await extractCipher(res);
    return castleSafeParse(decryptCastle(cipher, secKey));
}

async function getCastleDetails(secKey, movieId) {
    const url = `${CASTLE_BASE}/film-api/v1.9.9/movie?channel=${CHANNEL}&clientType=${CLIENT}&lang=${LANG}&movieId=${movieId}&packageName=${PKG}`;
    const res = await castleRequest(url);
    const cipher = await extractCipher(res);
    return castleSafeParse(decryptCastle(cipher, secKey));
}

async function getVideoByLanguage(secKey, movieId, episodeId, languageId, resolution) {
    const body = {
        mode: '1',
        appMarket: 'GuanWang',
        clientType: CLIENT,
        woolUser: 'false',
        apkSignKey: 'ED0955EB04E67A1D9F3305B95454FED485261475',
        androidVersion: '13',
        movieId,
        episodeId,
        languageId,
        isNewUser: 'true',
        resolution: resolution.toString(),
        packageName: PKG
    };
    const url = `${CASTLE_BASE}/film-api/v2.0.1/movie/getVideo2?clientType=${CLIENT}&packageName=${PKG}&channel=${CHANNEL}&lang=${LANG}`;
    const res = await castleRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const cipher = await extractCipher(res);
    return castleSafeParse(decryptCastle(cipher, secKey));
}

function resolutionLabel(res) {
    const map = { 1: '480p', 2: '720p', 3: '1080p' };
    return map[res] || `${res}p`;
}

const KNOWN_HEIGHTS = new Set([240, 360, 480, 540, 576, 720, 1080, 1440, 2160]);

function knownHeight(value) {
    const n = Number(value);
    return Number.isFinite(n) && KNOWN_HEIGHTS.has(n);
}

function resolutionNumToLabel(num) {
    const map = { 1: '480p', 2: '720p', 3: '1080p', 4: '4K' };
    return map[num] || null;
}

function streamQuality(url, description, resolutionNum, defaultQual) {
    if (description) {
        const m = /(?:SD|HD|FHD|UHD|4K)?\s*(\d{3,4})\s*p?/i.exec(String(description).trim());
        if (m && knownHeight(m[1])) {
            return `${m[1]}p`;
        }
        if (/4k|uhd/i.test(String(description))) return '4K';
    }
    const numLabel = resolutionNumToLabel(Number(resolutionNum));
    if (numLabel) return numLabel;
    if (url) {
        const tokens = url.match(/[^/a-z](?:(\d{3,4})\s*p?)[^a-z]/gi);
        if (tokens) {
            for (const t of tokens) {
                const m = /(\d{3,4})/i.exec(t);
                if (m && knownHeight(m[1])) return `${m[1]}p`;
            }
        }
    }
    return defaultQual;
}

function formatSize(bytes) {
    if (typeof bytes !== 'number' || bytes <= 0) return 'Unknown';
    if (bytes > 1000000000) return `${(bytes / 1000000000).toFixed(2)} GB`;
    return `${(bytes / 1000000).toFixed(0)} MB`;
}

// ============================================
// ✅ دالة استخراج audio tracks من M3U8 (بمنطق VixSrc)
// ============================================

/**
 * استخراج جميع مسارات الصوت من ملف M3U8 (master أو index)
 * تعيد مصفوفة من الكائنات مع language, label, uri, isDefault, isForced
 */
function extractAudioTracksFromM3U8Content(content, baseUrl) {
    if (!content) return [];
    const audioTracks = [];
    const lines = content.split('\n');

    for (const line of lines) {
        if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) continue;
        const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] || 'unknown';
        const label = line.match(/NAME="([^"]+)"/)?.[1] || 'Audio';
        let uri = line.match(/URI="([^"]+)"/)?.[1] || null;
        const isDefault = line.includes('DEFAULT=YES') || line.includes('DEFAULT=1');
        const isForced = line.includes('FORCED=YES') || line.includes('FORCED=1');

        if (uri) {
            // جعل الرابط مطلقاً
            if (!uri.startsWith('http')) {
                const base = baseUrl.endsWith('/') ? baseUrl : baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
                uri = base + uri;
            }
            // إزالة التكرارات (نفس اللغة)
            if (!audioTracks.find(t => t.language === language)) {
                audioTracks.push({
                    language: language,
                    label: label,
                    name: label,
                    uri: uri,
                    isDefault: isDefault,
                    isForced: isForced,
                    channels: null,
                    type: 'audio'
                });
            }
        }
    }

    // ترتيب: الإنجليزية أولاً
    audioTracks.sort((a, b) => {
        if (a.language === 'en' || a.language === 'eng') return -1;
        if (b.language === 'en' || b.language === 'eng') return 1;
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return 0;
    });

    return audioTracks;
}

/**
 * تحميل ملف M3U8 من رابط (يحاول master أولاً، ثم index)
 */
async function fetchPlaylistContent(url) {
    try {
        const response = await axios.get(url, {
            headers: PLAYBACK_HEADERS,
            timeout: 10000,
            responseType: 'text'
        });
        return response.data;
    } catch {
        return null;
    }
}

// ============================================
// ✅ الدالة الرئيسية المعدلة
// ============================================

async function getCastletvStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[CastleTV] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const type = mediaType === 'tv' ? 'series' : 'movie';
        const tmdbType = mediaType === 'tv' ? 'tv' : 'movie';
        const details = await getDetails(tmdbType, tmdbId);
        const title = (details && (details.title || details.name)) || '';
        const year = (details && (details.release_date || details.first_air_date || '').slice(0, 4)) || null;
        const originalLanguage = (details && details.original_language) || 'en';

        if (!title) return [];

        const season = seasonNum || 1;
        const episode = episodeNum || 1;
        const titleLine = type === 'series'
            ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}${year ? ` (${year})` : ''}`
            : `${title}${year ? ` (${year})` : ''}`;

        const secKey = await getSecurityKey();
        const keyword = year ? `${title} ${year}` : title;
        const searchResult = await searchCastle(secKey, keyword);
        const rows = (unwrap(searchResult).rows || []);

        if (rows.length === 0) return [];

        const titleLc = title.toLowerCase();
        const match = rows.find((r) => {
            const name = (r.title || r.name || '').toLowerCase();
            return name.includes(titleLc) || titleLc.includes(name);
        }) || rows[0];

        if (!match) return [];
        const castleId = (match.id || match.redirectId || match.redirectIdStr || '').toString();
        if (!castleId) return [];

        let castleDetails = await getCastleDetails(secKey, castleId);
        let activeId = castleId;

        if (type === 'series') {
            const seasons = (unwrap(castleDetails).seasons || []);
            const seasonEntry = seasons.find((s) => s.number === season);
            if (seasonEntry && seasonEntry.movieId && seasonEntry.movieId.toString() !== castleId) {
                castleDetails = await getCastleDetails(secKey, seasonEntry.movieId.toString());
                activeId = seasonEntry.movieId.toString();
            }
        }

        const episodes = (unwrap(castleDetails).episodes || []);
        let episodeId = null;

        if (type === 'series') {
            const ep = episodes.find((e) => e.number === episode);
            episodeId = ep && ep.id ? ep.id.toString() : null;
        } else {
            episodeId = episodes[0] && episodes[0].id ? episodes[0].id.toString() : null;
        }

        if (!episodeId) return [];

        const epEntry = episodes.find((e) => e.id && e.id.toString() === episodeId);
        const allTracks = (epEntry && epEntry.tracks) || [];

        // اختيار المسار المطابق للغة الأصلية، وإلا أول مسار
        let preferredTrack = null;
        if (originalLanguage) {
            preferredTrack = allTracks.find((t) => {
                if (!t) return false;
                const lang = String(t.languageName || t.abbreviate || '').toLowerCase();
                return lang.includes(originalLanguage);
            });
        }
        if (!preferredTrack && allTracks.length > 0) {
            preferredTrack = allTracks[0];
        }
        if (!preferredTrack) {
            console.log(`[CastleTV] No tracks found for "${title}"`);
            return [];
        }

        const subtitlesMap = new Map();
        const qualityStreamsMap = new Map();
        let globalAudioTracks = [];

        // جلب الفيديو للمسار المفضل
        const resResults = await Promise.allSettled(
            [3, 2, 1].map((resolution) =>
                getVideoByLanguage(secKey, activeId, episodeId, String(preferredTrack.languageId), resolution)
                    .then((raw) => ({ raw, resolution }))
            )
        );

        for (const r of resResults) {
            if (r.status !== 'fulfilled') continue;
            const { raw, resolution } = r.value;
            const data = unwrap(raw);
            const defaultQual = resolutionLabel(resolution);

            // استخراج الترجمات
            if (data.subtitles && Array.isArray(data.subtitles)) {
                for (const s of data.subtitles) {
                    if (s.url && typeof s.url === 'string') {
                        const subLang = s.abbreviate || s.title || 'Unknown';
                        const cleanUrl = s.url.replace(/ /g, '%20');
                        if (!subtitlesMap.has(cleanUrl)) {
                            subtitlesMap.set(cleanUrl, {
                                url: cleanUrl,
                                lang: subLang,
                                id: `castle-sub-${s.languageId || subLang}`
                            });
                        }
                    }
                }
            }

            // استخراج روابط الفيديو حسب الجودة
            const videos = data.videos && data.videos.length > 0 ? data.videos : (data.videoUrl ? [{ url: data.videoUrl, size: data.size }] : []);
            for (const v of videos) {
                const videoUrl = v.url || data.videoUrl;
                if (!videoUrl) continue;
                const qual = streamQuality(videoUrl, v.resolutionDescription || data.resolutionDescription, Number(v.resolution) || resolution, defaultQual);
                if (!qualityStreamsMap.has(qual)) {
                    qualityStreamsMap.set(qual, {
                        url: videoUrl,
                        size: v.size || data.size,
                        qual: qual
                    });
                }
            }
        }

        // ============================================
        // ✅ استخراج audioTracks من M3U8 (بمنطق VixSrc)
        // ============================================
        if (qualityStreamsMap.size > 0) {
            // نأخذ أول رابط من qualityStreamsMap
            const firstEntry = qualityStreamsMap.values().next().value;
            if (firstEntry && firstEntry.url) {
                const indexUrl = firstEntry.url;
                // محاولة تحويل إلى master.m3u8
                let masterUrl = indexUrl.replace(/\/[^/]+\.m3u8$/, '/master.m3u8');
                // إذا كان الرابط يحتوي على index_XXX، نستبدله بـ master
                masterUrl = masterUrl.replace(/\/index_\d+\.m3u8$/, '/master.m3u8');
                // إذا لم يتغير، نستخدم الرابط نفسه
                if (masterUrl === indexUrl) {
                    // قد يكون الرابط أصلاً master
                    masterUrl = indexUrl;
                }

                console.log(`[CastleTV] Attempting to fetch master playlist: ${masterUrl}`);
                let playlistContent = await fetchPlaylistContent(masterUrl);
                if (!playlistContent) {
                    // إذا فشل master، نجرب index نفسه
                    console.log(`[CastleTV] Master failed, trying index playlist: ${indexUrl}`);
                    playlistContent = await fetchPlaylistContent(indexUrl);
                }

                if (playlistContent) {
                    const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
                    globalAudioTracks = extractAudioTracksFromM3U8Content(playlistContent, baseUrl);
                    if (globalAudioTracks.length > 0) {
                        console.log(`[CastleTV] Found ${globalAudioTracks.length} audio tracks from M3U8.`);
                    } else {
                        console.log('[CastleTV] No audio tracks found in playlist.');
                    }
                } else {
                    console.log('[CastleTV] Could not fetch any playlist for audio tracks.');
                }
            }
        }

        // إذا لم نجد audioTracks، نضيف مساراً افتراضياً (لغة الملف)
        if (globalAudioTracks.length === 0) {
            const defaultLang = originalLanguage || 'en';
            globalAudioTracks.push({
                language: defaultLang,
                label: getLanguageName(defaultLang),
                name: getLanguageName(defaultLang),
                uri: null, // لا يوجد رابط منفصل، سيستخدم المسار المدمج في الفيديو
                isDefault: true,
                isForced: false,
                channels: null,
                type: 'audio'
            });
            console.log(`[CastleTV] No audio tracks found; added default '${defaultLang}' as fallback.`);
        }

        // ترتيب audioTracks: نضع اللغة الأصلية أو الإنجليزية أولاً ونجعلها default
        const preferredLang = originalLanguage || 'en';
        const preferredIndex = globalAudioTracks.findIndex(t => t.language === preferredLang || t.language === 'en');
        if (preferredIndex > 0) {
            const [track] = globalAudioTracks.splice(preferredIndex, 1);
            track.isDefault = true;
            globalAudioTracks.forEach(t => t.isDefault = false);
            globalAudioTracks.unshift(track);
        } else if (globalAudioTracks.length > 0) {
            globalAudioTracks[0].isDefault = true;
            for (let i = 1; i < globalAudioTracks.length; i++) {
                globalAudioTracks[i].isDefault = false;
            }
        }

        const subtitles = Array.from(subtitlesMap.values());
        const streams = [];

        for (const [qual, info] of qualityStreamsMap.entries()) {
            const streamObj = {
                name: `CastleTV | ${preferredTrack.languageName || 'Unknown'}`,
                title: `${titleLine}\n${qual} | ${preferredTrack.languageName || 'Unknown'} Audio | ${formatSize(info.size)}`,
                url: info.url,
                quality: qual,
                provider: 'CastleTV',
                headers: PLAYBACK_HEADERS,
                subtitles: subtitles,
                audioTracks: globalAudioTracks,
                hasAudioTracks: globalAudioTracks.length > 0
            };
            streams.push(streamObj);
        }

        const qualOrder = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1 };
        streams.sort((a, b) => (qualOrder[b.quality] || 0) - (qualOrder[a.quality] || 0));

        console.log(`[CastleTV] Generated ${streams.length} streams with ${globalAudioTracks.length} audio tracks for "${title}"`);
        return streams;
    } catch (err) {
        console.error(`[CastleTV] Error: ${err.message}`);
        return [];
    }
}

// دالة مساعدة لتسمية اللغة (مستنسخة من VixSrc)
function getLanguageName(langCode) {
    const map = {
        'en': 'English', 'eng': 'English', 'english': 'English',
        'ar': 'Arabic', 'ara': 'Arabic', 'arabic': 'Arabic',
        'es': 'Spanish', 'spa': 'Spanish', 'spanish': 'Spanish',
        'fr': 'French', 'fra': 'French', 'french': 'French',
        'de': 'German', 'deu': 'German', 'german': 'German',
        'hi': 'Hindi', 'hin': 'Hindi', 'hindi': 'Hindi',
        'it': 'Italian', 'ita': 'Italian', 'italian': 'Italian',
        'pt': 'Portuguese', 'por': 'Portuguese', 'portuguese': 'Portuguese',
        'ru': 'Russian', 'rus': 'Russian', 'russian': 'Russian',
        'ja': 'Japanese', 'jpn': 'Japanese', 'japanese': 'Japanese',
        'ko': 'Korean', 'kor': 'Korean', 'korean': 'Korean',
        'zh': 'Chinese', 'zho': 'Chinese', 'chinese': 'Chinese',
        'nl': 'Dutch', 'nld': 'Dutch', 'dutch': 'Dutch',
        'pl': 'Polish', 'pol': 'Polish', 'polish': 'Polish',
        'sv': 'Swedish', 'swe': 'Swedish', 'swedish': 'Swedish',
        'da': 'Danish', 'dan': 'Danish', 'danish': 'Danish',
        'fi': 'Finnish', 'fin': 'Finnish', 'finnish': 'Finnish',
        'no': 'Norwegian', 'nor': 'Norwegian', 'norwegian': 'Norwegian',
        'el': 'Greek', 'ell': 'Greek', 'greek': 'Greek',
        'he': 'Hebrew', 'heb': 'Hebrew', 'hebrew': 'Hebrew',
        'th': 'Thai', 'tha': 'Thai', 'thai': 'Thai',
        'vi': 'Vietnamese', 'vie': 'Vietnamese', 'vietnamese': 'Vietnamese',
        'id': 'Indonesian', 'ind': 'Indonesian', 'indonesian': 'Indonesian',
        'ms': 'Malay', 'msa': 'Malay', 'malay': 'Malay',
        'tr': 'Turkish', 'tur': 'Turkish', 'turkish': 'Turkish'
    };
    return map[langCode?.toLowerCase()] || langCode || 'Unknown';
}

module.exports = { getStreams: getCastletvStreams };