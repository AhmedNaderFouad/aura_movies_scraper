// fourkHDhub.js - Enhanced Direct Video Stream Extractor (Multiple Qualities)
const cheerio = require('cheerio');
const { getTmdbApiKey } = require('../utils/tmdbKey');

// Base URL and request headers
const BASE_URL = 'https://4khdhub.dad';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Checks if a URL points directly to a video file or a CDN source.
 * Excludes known non-video paths (hubdrive, hubcloud, login, etc.).
 */
function isDirectVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();

    if (lower.includes('hubdrive') || lower.includes('hubcloud') ||
        lower.includes('pixel.hubcloud') || lower.includes('/login')) {
        return false;
    }

    const hasDirectExt = /\.(mp4|mkv|m3u8|webm|avi|mov)(\?.*)?$/i.test(lower);
    const isDirectCdn = lower.includes('workers.dev') || lower.includes('cdn.') ||
                        lower.includes('cloudflare') || lower.includes('storage');

    return hasDirectExt || isDirectCdn;
}

/**
 * Extracts quality label from a string (title, filename, or text).
 * Returns 'Unknown' if no quality indicator is found.
 */
function extractQuality(str) {
    const u = (str || '').toLowerCase();
    if (u.includes('2160p') || u.includes('4k') || u.includes('uhd')) return '2160p';
    if (u.includes('1080p') || u.includes('fullhd') || u.includes('fhd')) return '1080p';
    if (u.includes('720p') || u.includes('hd')) return '720p';
    if (u.includes('480p') || u.includes('sd')) return '480p';
    return 'Unknown';
}

// -----------------------------------------------------------------------------
// Resolver Functions (HubCloud, HubDrive, Generic)
// -----------------------------------------------------------------------------

/**
 * Extracts video links from a HubCloud page.
 * Returns an array of stream objects or null if no links found.
 */
async function resolveHubCloudEnhanced(url) {
    try {
        console.log(`[4KHDHub] Enhanced HubCloud extraction: ${url}`);
        const response = await fetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://4khdhub.dad/',
                Origin: 'https://4khdhub.dad',
            },
        });
        const html = await response.text();
        const $ = cheerio.load(html);

        const streams = [];
        const selectors = [
            '#download',
            'a[href*="hubcloud"]',
            'a[href*="download"]',
            'a.btn-primary',
            'a.btn-success',
            '.download-btn',
            'a[href*="file"]',
        ];

        let href = null;
        for (const selector of selectors) {
            const el = $(selector).first();
            if (el.length > 0) {
                href = el.attr('href');
                if (href && href.trim()) break;
            }
        }

        if (!href) {
            // Fallback: scan all anchor tags
            $('a').each((i, el) => {
                const link = $(el).attr('href');
                if (link && (link.includes('hubcloud') || link.includes('download') || link.includes('/file/'))) {
                    href = link;
                    return false; // break loop
                }
            });
        }

        if (!href) {
            console.log('[4KHDHub] No download link found on HubCloud page');
            return null;
        }

        // Normalize URL
        if (!href.startsWith('http')) {
            const base = url.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
            href = base + (href.startsWith('/') ? '' : '/') + href.replace(/^\//, '');
        }

        console.log(`[4KHDHub] Found download link: ${href}`);

        // Fetch the actual download page
        const downloadResponse = await fetch(href, {
            headers: {
                ...HEADERS,
                Referer: url,
                Origin: new URL(url).origin,
            },
        });
        const downloadHtml = await downloadResponse.text();
        const $d = cheerio.load(downloadHtml);

        const header = $d('div.card-header').text() || $d('h2').text() || $d('h3').text() || '';
        const quality = extractQuality(header);

        // Scan for download buttons
        $d('a.btn, a[href*="download"], a[href*="file"]').each((i, el) => {
            const link = $(el).attr('href');
            const text = $(el).text().trim();
            if (!link) return;
            if (link.includes('login') || link.includes('logout') || link.includes('action=logout')) {
                return;
            }

            let finalLink = link;
            if (!link.startsWith('http')) {
                const base = href.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
                finalLink = base + (link.startsWith('/') ? '' : '/') + link.replace(/^\//, '');
            }

            let linkQuality = extractQuality(text) || quality;
            const sizeMatch = text.match(/(\d+(?:\.\d+)?\s?(?:GB|MB|KB))/i);
            const size = sizeMatch ? sizeMatch[1] : 'Unknown';

            if (isDirectVideoUrl(finalLink) || finalLink.includes('workers.dev')) {
                streams.push({
                    url: finalLink,
                    quality: linkQuality || '1080p',
                    title: `4KHDHUB [${text || 'Download'}]`,
                    size: size,
                });
                console.log(`[4KHDHub] Found stream: ${finalLink.substring(0, 80)}... (${linkQuality})`);
            }
        });

        // If no button links, try the href itself
        if (streams.length === 0 && href) {
            if (isDirectVideoUrl(href) || href.includes('workers.dev')) {
                streams.push({
                    url: href,
                    quality: quality || '1080p',
                    title: '4KHDHUB [Direct Link]',
                    size: 'Unknown',
                });
            }
        }

        return streams.length ? streams : null;
    } catch (e) {
        console.error(`[4KHDHub] HubCloud extraction error: ${e.message}`);
        return null;
    }
}

/**
 * Extracts video links from a HubDrive page.
 * Returns an array of stream objects or null if no links found.
 */
async function resolveHubDriveEnhanced(url) {
    try {
        console.log(`[4KHDHub] Enhanced HubDrive extraction: ${url}`);
        const response = await fetch(url, {
            headers: {
                ...HEADERS,
                Referer: 'https://4khdhub.dad/',
                Origin: 'https://4khdhub.dad',
            },
        });
        const html = await response.text();
        const $ = cheerio.load(html);

        const streams = [];
        const selectors = [
            'a.btn-primary',
            'a.btn-success',
            'a[href*="download"]',
            'a[href*="file"]',
            '.download-btn',
            'a[href*="workers.dev"]',
            'a[href*="cdn"]',
        ];

        let foundAny = false;
        for (const selector of selectors) {
            $(selector).each((i, el) => {
                const link = $(el).attr('href');
                const text = $(el).text().trim();
                if (!link) return;
                if (link.includes('login') || link.includes('logout') || link.includes('action=logout')) {
                    return;
                }

                let finalLink = link;
                if (!link.startsWith('http')) {
                    const base = url.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
                    finalLink = base + (link.startsWith('/') ? '' : '/') + link.replace(/^\//, '');
                }

                const quality = extractQuality(text);
                const sizeMatch = text.match(/(\d+(?:\.\d+)?\s?(?:GB|MB|KB))/i);
                const size = sizeMatch ? sizeMatch[1] : 'Unknown';

                if (isDirectVideoUrl(finalLink) || finalLink.includes('workers.dev')) {
                    streams.push({
                        url: finalLink,
                        quality: quality || '1080p',
                        title: `4KHDHUB [${text || 'Download'}]`,
                        size: size,
                    });
                    foundAny = true;
                    console.log(`[4KHDHub] Found stream: ${finalLink.substring(0, 80)}... (${quality || '1080p'})`);
                }
            });
            if (foundAny) break;
        }

        // Fallback: if the URL itself is a direct video
        if (streams.length === 0 && isDirectVideoUrl(url)) {
            streams.push({
                url: url,
                quality: '1080p',
                title: '4KHDHUB [Direct Link]',
                size: 'Unknown',
            });
        }

        return streams.length ? streams : null;
    } catch (e) {
        console.error(`[4KHDHub] HubDrive extraction error: ${e.message}`);
        return null;
    }
}

/**
 * Resolves any video URL to a list of stream objects.
 * Handles direct links, HubCloud, HubDrive, and generic HTML page scanning.
 */
async function resolveVideoUrl(rawUrl) {
    try {
        const lower = rawUrl.toLowerCase();

        // Direct video link
        if (isDirectVideoUrl(rawUrl)) {
            return [{
                url: rawUrl,
                quality: extractQuality(rawUrl) || '1080p',
                title: '4KHDHUB [Direct]',
                size: 'Unknown',
            }];
        }

        // HubCloud
        if (lower.includes('hubcloud')) {
            const result = await resolveHubCloudEnhanced(rawUrl);
            if (result) return result;
        }

        // HubDrive
        if (lower.includes('hubdrive')) {
            const result = await resolveHubDriveEnhanced(rawUrl);
            if (result) return result;
        }

        // Generic page: scan all anchor tags
        try {
            const response = await fetch(rawUrl, { headers: HEADERS });
            const html = await response.text();
            const $ = cheerio.load(html);
            const streams = [];

            $('a[href]').each((i, el) => {
                const link = $(el).attr('href');
                if (!link) return;
                if (link.includes('login') || link.includes('logout')) return;

                let finalLink = link;
                if (!link.startsWith('http')) {
                    const base = rawUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
                    finalLink = base + (link.startsWith('/') ? '' : '/') + link.replace(/^\//, '');
                }

                if (isDirectVideoUrl(finalLink)) {
                    const text = $(el).text().trim();
                    streams.push({
                        url: finalLink,
                        quality: extractQuality(text) || extractQuality(finalLink) || '1080p',
                        title: `4KHDHUB [${text || 'Link'}]`,
                        size: 'Unknown',
                    });
                }
            });

            if (streams.length > 0) return streams;
        } catch (e) {
            // Silently ignore generic page errors
        }

        return null;
    } catch (e) {
        console.error(`[4KHDHub] Error resolving URL: ${e.message}`);
        return null;
    }
}

// -----------------------------------------------------------------------------
// Main Search and Extraction Function
// -----------------------------------------------------------------------------

/**
 * Searches for the given TMDB ID (movie or TV) on 4kHDHub and extracts streams.
 * Returns an array of stream objects sorted by quality (highest first).
 */
async function searchAndGetStreams(tmdbId, mediaType = 'movie', season = 1, episode = 1) {
    try {
        console.log(`[4KHDHub] Starting search for TMDB: ${tmdbId}, Type: ${mediaType}`);

        const tmdbKey = getTmdbApiKey();
        if (!tmdbKey) {
            console.error('[4KHDHub] No TMDB API key available');
            return [];
        }

        // Fetch TMDB data
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbKey}`;
        const tmdbRes = await fetch(tmdbUrl);
        if (!tmdbRes.ok) {
            console.log(`[4KHDHub] TMDB request failed: ${tmdbRes.status}`);
            return [];
        }
        const mediaInfo = await tmdbRes.json();
        const title = mediaInfo.title || mediaInfo.name;
        if (!title) {
            console.log('[4KHDHub] No title found');
            return [];
        }

        console.log(`[4KHDHub] Title: ${title}`);

        // Search on 4kHDHub
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(title)}`;
        const searchResp = await fetch(searchUrl, { headers: HEADERS });
        if (!searchResp.ok) {
            console.log(`[4KHDHub] Search failed: ${searchResp.status}`);
            return [];
        }
        const searchHtml = await searchResp.text();
        const $ = cheerio.load(searchHtml);

        const results = [];
        $('div.card-grid a, a[href*="/movie/"], a[href*="/tv/"]').each((i, a) => {
            const href = $(a).attr('href');
            const t = $(a).find('h3').text().trim() || $(a).attr('title') || '';
            if (href && t) {
                results.push({ title: t, url: href });
            }
        });

        if (!results.length) {
            console.log('[4KHDHub] No search results found');
            return [];
        }

        console.log(`[4KHDHub] Found ${results.length} search results`);

        // Find best match
        const isTV = mediaType === 'tv';
        const lcTitle = title.toLowerCase();
        let match = results.find(r => r.title.toLowerCase().includes(lcTitle));
        if (!match) {
            const titleWords = lcTitle.split(' ').filter(w => w.length > 2);
            for (const result of results) {
                const rLower = result.title.toLowerCase();
                const matchedWords = titleWords.filter(w => rLower.includes(w));
                if (matchedWords.length >= titleWords.length * 0.6) {
                    match = result;
                    break;
                }
            }
        }
        if (!match) match = results[0];

        const pageUrl = match.url.startsWith('http') ? match.url : `${BASE_URL}${match.url}`;
        console.log(`[4KHDHub] Using page: ${pageUrl}`);

        // Load the detail page
        const pageResp = await fetch(pageUrl, { headers: HEADERS });
        if (!pageResp.ok) {
            console.log(`[4KHDHub] Page load failed: ${pageResp.status}`);
            return [];
        }
        const pageHtml = await pageResp.text();
        const $page = cheerio.load(pageHtml);

        const rawStreams = [];

        if (isTV) {
            // TV: try to find specific episode links
            const episodeLinks = [];
            $page('div.episode-download-item, .episode-item, .episode-card').each((i, epItem) => {
                const epText = $page(epItem).find('span.badge-psa, .episode-number, .episode-badge').text() || '';
                const epMatch = epText.match(/Episode[-_\s]*0*([1-9][0-9]*)/i);
                if (epMatch && parseInt(epMatch[1]) === parseInt(episode)) {
                    $page(epItem).find('a[href]').each((j, a) => {
                        const href = $page(a).attr('href');
                        if (href && href.trim()) {
                            let fullHref = href;
                            if (!href.startsWith('http')) {
                                const base = pageUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
                                fullHref = base + (href.startsWith('/') ? '' : '/') + href.replace(/^\//, '');
                            }
                            episodeLinks.push(fullHref);
                        }
                    });
                }
            });

            // Fallback: if no episode-specific links, grab first few download links
            if (episodeLinks.length === 0) {
                $page('a[href*="hubdrive"], a[href*="hubcloud"], a[href*="download"]').each((i, a) => {
                    if (i >= 3) return;
                    const href = $(a).attr('href');
                    if (href && href.trim()) {
                        let fullHref = href;
                        if (!href.startsWith('http')) {
                            const base = pageUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || '';
                            fullHref = base + (href.startsWith('/') ? '' : '/') + href.replace(/^\//, '');
                        }
                        episodeLinks.push(fullHref);
                    }
                });
            }

            // Resolve each episode link
            for (const link of episodeLinks.slice(0, 5)) {
                const streams = await resolveVideoUrl(link);
                if (streams) {
                    for (const s of streams) {
                        rawStreams.push({
                            ...s,
                            title: `${title} S${season}E${episode} - ${s.title}`,
                        });
                    }
                }
            }
        } else {
            // Movie: extract all download links from the page
            const hrefs = [];
            $page('div.download-item a, a[href*="hubdrive"], a[href*="hubcloud"], a[href*="download"], a.btn').each((i, a) => {
                const href = $(a).attr('href');
                if (href && href.trim() && href.startsWith('http')) {
                    hrefs.push(href);
                }
            });

            console.log(`[4KHDHub] Found ${hrefs.length} download links`);

            for (const href of hrefs.slice(0, 8)) {
                const streams = await resolveVideoUrl(href);
                if (streams) {
                    for (const s of streams) {
                        rawStreams.push(s);
                    }
                }
            }
        }

        // Deduplicate and clean streams
        const uniqueUrls = new Set();
        const finalStreams = [];

        for (const link of rawStreams) {
            if (!link.url) continue;
            if (link.url.includes('login') || link.url.includes('logout')) continue;

            const key = link.url.split('?')[0];
            if (uniqueUrls.has(key)) continue;
            uniqueUrls.add(key);

            let quality = link.quality || 'Unknown';
            if (quality === 'Unknown' || quality === 'Auto') {
                quality = extractQuality(link.url) || '1080p';
            }

            finalStreams.push({
                name: '4KHDHUB Direct Stream',
                title: link.title || '4KHDHUB',
                url: link.url,
                quality: quality,
                size: link.size || 'Unknown',
                headers: {
                    ...HEADERS,
                    Referer: 'https://4khdhub.dad/',
                    Origin: 'https://4khdhub.dad',
                },
                provider: 'fourkhdhub',
            });
        }

        console.log(`[4KHDHub] Returning ${finalStreams.length} streams`);

        // Sort by quality (best first)
        const qualityOrder = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, 'Unknown': 4 };
        finalStreams.sort((a, b) => (qualityOrder[a.quality] || 99) - (qualityOrder[b.quality] || 99));

        return finalStreams;
    } catch (e) {
        console.error('[4KHDHUB Error]', e.message);
        return [];
    }
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
    getStreams: searchAndGetStreams,
    scrape: searchAndGetStreams,
};