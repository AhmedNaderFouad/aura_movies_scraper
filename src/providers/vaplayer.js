const { resolveImdbId } = require('../utils/tmdb');

const STREAM_API = 'https://streamdata.vaplayer.ru/api.php';
const PLAYER_ORIGIN = 'https://nextgencloudfabric.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchStreamData(imdb, type, season, episode) {
    const params = new URLSearchParams({ imdb, type });
    if (type === 'tv' && season != null && episode != null) {
        params.set('season', String(season));
        params.set('episode', String(episode));
    }

    const url = `${STREAM_API}?${params.toString()}`;
    const referer = type === 'tv'
        ? `${PLAYER_ORIGIN}/embed/tv/${imdb}/${season}/${episode}`
        : `${PLAYER_ORIGIN}/embed/movie/${imdb}`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': referer,
                'Origin': PLAYER_ORIGIN
            }
        });
        clearTimeout(timer);

        if (!resp.ok) {
            throw new Error(`VaPlayer API HTTP ${resp.status}`);
        }

        const json = await resp.json();
        if (json.status_code !== '200' && json.status_code !== 200) {
            throw new Error(`VaPlayer API error: ${json.error || `status_code=${json.status_code}`}`);
        }

        return json.data || {};
    } catch (err) {
        console.warn(`[VaPlayer] fetch failed for ${imdb}: ${err.message}`);
        return {};
    }
}

function toStreams(data, labelSuffix = '') {
    const streamUrls = data.stream_urls || [];
    
    const audioTracks = (data.audioTracks || data.audios || data.audio || [])
        .filter((a) => (typeof a === 'object' && (a.url || a.file)) || typeof a === 'string')
        .map((a, i) => ({
            url: typeof a === 'string' ? a : a.url || a.file,
            lang: a.lang || a.language || a.label || a.name || 'Unknown',
            label: a.label || a.name || a.lang || 'Unknown',
            id: `vaplayer-audio-${i}`
        }));

    return streamUrls.map((url, i) => ({
        name: 'VaPlayer',
        title: `VaPlayer${labelSuffix ? ` ${labelSuffix}` : ''} · HLS ${i + 1}`,
        url,
        quality: 'Auto',
        provider: 'VaPlayer',
        headers: {
            'Referer': `${PLAYER_ORIGIN}/`,
            'Origin': PLAYER_ORIGIN,
            'User-Agent': USER_AGENT
        },
        ...(audioTracks.length ? { audioTracks } : {})
    }));
}

async function getVaplayerStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VaPlayer] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const imdbId = await resolveImdbId(mediaType === 'tv' ? 'tv' : 'movie', tmdbId);
        if (!imdbId || !imdbId.startsWith('tt')) {
            console.log(`[VaPlayer] No IMDB ID resolved for TMDB ${tmdbId}`);
            return [];
        }

        const data = mediaType === 'tv' && seasonNum !== null && episodeNum !== null
            ? await fetchStreamData(imdbId, 'tv', seasonNum, episodeNum)
            : await fetchStreamData(imdbId, 'movie');

        const streams = toStreams(data, mediaType === 'tv' ? `S${seasonNum}E${episodeNum}` : '');
        console.log(`[VaPlayer] Got ${streams.length} stream(s) for ${imdbId}`);
        return streams;
    } catch (err) {
        console.error(`[VaPlayer] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getStreams: getVaplayerStreams };