// src/providers/allwish.js
// AllWish Provider - Anime & TV Shows (with English audio support)
// Part of AuraMovies local scrapers collection

const cheerio = require('cheerio');

// ============================================
//  Configuration
// ============================================

const BASE_URL = 'https://all-wish.me';

//  API Key from environment variables (hidden from GitHub)
const TMDB_API_KEY = process.env.TMDB_API_KEY || '2194dd3db7b2fbdc87cfc20cbda3b0d2';

const XML_HEADER = {
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

// ============================================
//  Utility Functions
// ============================================

/**
 * Base64 encode a string (Node.js Buffer fallback)
 */
function btoa(str) {
  return Buffer.from(str, 'binary').toString('base64');
}

/**
 * Fetch JSON from URL with headers
 */
async function fetchJson(url, headers = XML_HEADER) {
  const res = await fetch(url, { headers });
  return await res.json();
}

/**
 * Fetch text from URL with headers
 */
async function fetchText(url, headers = XML_HEADER) {
  const res = await fetch(url, { headers });
  return await res.text();
}

/**
 * Get TMDB details (title and year)
 */
async function getTmdbDetails(tmdbId, mediaType) {
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  return {
    title: data.title || data.name,
    year: (data.release_date || data.first_air_date || '').split('-')[0]
  };
}

/**
 * Resolve TMDB ID from IMDb ID
 */
async function resolveTmdbId(id, mediaType) {
  if (!String(id).startsWith('tt')) return id;

  const url = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  const data = await fetchJson(url);

  const tmdbId = mediaType === 'movie'
    ? data?.movie_results?.[0]?.id
    : data?.tv_results?.[0]?.id;

  if (!tmdbId) throw new Error('Failed to resolve TMDB ID');
  return tmdbId;
}

/**
 * Generate episode VRf token (AllWish specific encryption)
 */
function generateEpisodeVrf(episodeId) {
  const secretKey = 'ysJhV6U27FVIjjuk';
  const encodedId = encodeURIComponent(episodeId);
  const keyCodes = secretKey.split('').map(c => c.charCodeAt(0));
  const dataCodes = encodedId.split('').map(c => c.charCodeAt(0));

  const n = Array.from({ length: 256 }, (_, i) => i);
  let a = 0;

  for (let o = 0; o < 256; o++) {
    a = (a + n[o] + keyCodes[o % keyCodes.length]) % 256;
    [n[o], n[a]] = [n[a], n[o]];
  }

  const out = [];
  let o = 0;
  a = 0;

  for (let r = 0; r < dataCodes.length; r++) {
    o = (o + 1) % 256;
    a = (a + n[o]) % 256;
    [n[o], n[a]] = [n[a], n[o]];
    const k = n[(n[o] + n[a]) % 256];
    out.push(dataCodes[r] ^ k);
  }

  const bytes = new Uint8Array(out.map(b => b & 255));
  let base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const transformed = [];
  for (let i = 0; i < base64.length; i++) {
    let s = base64.charCodeAt(i);
    const mod = i % 8;
    if (mod === 1) s += 3;
    else if (mod === 7) s += 5;
    else if (mod === 2) s -= 4;
    else if (mod === 4) s -= 2;
    else if (mod === 6) s += 4;
    else if (mod === 0) s -= 3;
    else if (mod === 3) s += 2;
    else if (mod === 5) s += 5;
    transformed.push(s & 255);
  }

  const bytes2 = new Uint8Array(transformed);
  let base2 = btoa(String.fromCharCode(...bytes2))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return base2.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ============================================
//  Stream Extraction Functions
// ============================================

/**
 * Extract stream from MegaPlay server
 */
async function extractMegaPlay(realUrl, sectionType) {
  try {
    const embedHtml = await fetchText(realUrl, {
      Referer: 'https://megaplay.buzz/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      DNT: '1',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    const megaId = embedHtml.match(/data-id="(\d+)"/)?.[1];
    if (!megaId) return [];

    const megaApi = `https://megaplay.buzz/stream/getSources?id=${megaId}`;
    const megaRes = await fetchJson(megaApi, {
      Referer: realUrl,
      Origin: 'https://megaplay.buzz',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.5'
    });

    const source = megaRes?.sources?.file;
    if (!source) return [];

    return [{
      name: `AllWish - MegaPlay ${(sectionType || 'SUB').toUpperCase()}`,
      title: `MegaPlay ${(sectionType || 'SUB').toUpperCase()}`,
      url: source,
      quality: '1080p',
      subtitles: megaRes?.tracks?.map(track => ({
        lang: track.label || 'Unknown',
        url: track.file
      })) || [],
      headers: {
        'Referer': 'https://megaplay.buzz/',
        'Origin': 'https://megaplay.buzz',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site'
      }
    }];
  } catch (e) {
    console.log(`[AllWish] MegaPlay extraction error: ${e.message}`);
    return [];
  }
}

/**
 * Find best match from search results
 */
function findBestMatch(results, targetTitle, targetYear) {
  if (!results || results.length === 0) return null;

  const targetLower = targetTitle.toLowerCase().trim();
  const targetYearStr = targetYear ? String(targetYear) : '';

  // 1. Exact match with year
  for (const result of results) {
    const titleLower = result.title.toLowerCase().trim();
    if (titleLower === targetLower && targetYearStr && result.title.includes(`(${targetYearStr})`)) {
      return result;
    }
  }

  // 2. Partial match with year
  for (const result of results) {
    const titleLower = result.title.toLowerCase().trim();
    if ((titleLower.includes(targetLower) || targetLower.includes(titleLower)) &&
      targetYearStr && result.title.includes(`(${targetYearStr})`)) {
      return result;
    }
  }

  // 3. Partial match without year
  for (const result of results) {
    const titleLower = result.title.toLowerCase().trim();
    if (titleLower.includes(targetLower) || targetLower.includes(titleLower)) {
      return result;
    }
  }

  // 4. Keyword matching (first 3 words > 3 chars)
  const keyWords = targetLower.split(' ').filter(w => w.length > 3).slice(0, 3);
  for (const result of results) {
    const titleLower = result.title.toLowerCase().trim();
    let matchCount = 0;
    for (const word of keyWords) {
      if (titleLower.includes(word)) matchCount++;
    }
    if (matchCount >= keyWords.length * 0.6) {
      return result;
    }
  }

  return null;
}

// ============================================
//  Main Stream Function (exported)
// ============================================

async function getStreams(tmdbId, mediaType = 'movie', season = 1, episode = 1) {
  try {
    // 1. Get TMDB details
    tmdbId = await resolveTmdbId(tmdbId, mediaType);
    const { title, year } = await getTmdbDetails(tmdbId, mediaType);
    if (!title) return [];

    console.log(`[AllWish] 🔍 Searching for: ${title} (${year || 'Unknown year'})`);

    // 2. Search
    const searchUrl = `${BASE_URL}/filter?keyword=${encodeURIComponent(title)}`;
    const searchHtml = await fetchText(searchUrl);
    const $ = cheerio.load(searchHtml);

    // 3. Collect results
    const results = [];
    $('div.item').each((_, item) => {
      const titleEl = $(item).find('div.name > a');
      const href = titleEl.attr('href');
      const titleText = titleEl.text().trim();
      if (href && titleText) {
        const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
        const yearMatch = titleText.match(/\((\d{4})\)/);
        results.push({
          title: titleText,
          url: fullUrl.replace(/\/+$/, ''),
          year: yearMatch ? yearMatch[1] : null
        });
      }
    });

    if (results.length === 0) {
      console.log('[AllWish] ❌ No search results found');
      return [];
    }

    console.log(`[AllWish]  Found ${results.length} search results`);

    // 4. Find best match
    let bestMatch = findBestMatch(results, title, year);
    let animeUrl = bestMatch ? bestMatch.url : results[0]?.url;
    if (!animeUrl) return [];

    // 5. Load page and verify
    const animePage = await fetchText(animeUrl);
    const $2 = cheerio.load(animePage);
    const pageTitle = $2('h1.title').text().trim() || $2('title').text().trim() || '';
    console.log(`[AllWish]  Page title: ${pageTitle}`);

    // 6. Fallback to next result if page doesn't match
    if (!pageTitle.toLowerCase().includes(title.toLowerCase()) && results.length > 1) {
      console.log('[AllWish]  Page title doesn\'t match, trying next result...');
      const nextMatch = results.find(r => r !== bestMatch && r.title.toLowerCase().includes(title.toLowerCase()));
      if (nextMatch) {
        animeUrl = nextMatch.url;
        console.log(`[AllWish]  Using: ${animeUrl}`);
      }
    }

    // 7. Get episode list
    const dataId = $2('main > div.container').attr('data-id');
    if (!dataId) {
      console.log('[AllWish]  No data-id found');
      return [];
    }

    const vrf = generateEpisodeVrf(dataId);
    const epListUrl = `${BASE_URL}/ajax/episode/list/${dataId}?vrf=${vrf}`;
    const epListRes = await fetchJson(epListUrl);

    if (!epListRes || epListRes.status !== 200) return [];

    const $3 = cheerio.load(epListRes.result || '');
    let episodeIds = null;
    const targetEp = episode || 1;

    $3('div.range > div > a').each((_, el) => {
      const slug = $3(el).attr('data-slug');
      if (parseInt(slug, 10) === targetEp) {
        episodeIds = $3(el).attr('data-ids');
      }
    });

    if (!episodeIds) {
      episodeIds = $3('div.range > div > a').first().attr('data-ids');
    }
    if (!episodeIds) return [];

    // 8. Get server list
    const serverListUrl = `${BASE_URL}/ajax/server/list?servers=${episodeIds}`;
    const serverListRes = await fetchJson(serverListUrl);
    if (!serverListRes || serverListRes.status !== 200) return [];

    const $4 = cheerio.load(serverListRes.result || '');
    const serverEls = [];

    $4('div.server-type').each((_, section) => {
      $4(section).find('div.server-list > div.server').each((__, server) => {
        const dataLinkId = $4(server).attr('data-link-id');
        const sectionType = $4(section).attr('data-type');
        if (dataLinkId) {
          serverEls.push({ dataLinkId, sectionType });
        }
      });
    });

    // 9. Fetch streams
    const streams = [];
    for (const { dataLinkId, sectionType } of serverEls.slice(0, 5)) {
      try {
        const apiUrl = `${BASE_URL}/ajax/server?get=${dataLinkId}`;
        const apiRes = await fetchJson(apiUrl);
        const realUrl = apiRes?.result?.url;
        if (!realUrl) continue;

        if (realUrl.includes('megaplay') || realUrl.includes('rapid-cloud')) {
          const megaStreams = await extractMegaPlay(realUrl, sectionType);
          streams.push(...megaStreams);
          continue;
        }

        streams.push({
          name: `AllWish - ${(sectionType || 'SUB').toUpperCase()}`,
          title: `AllWish ${(sectionType || 'SUB').toUpperCase()}`,
          url: realUrl,
          quality: '1080p',
          headers: {
            'Referer': 'https://all-wish.me/',
            'Origin': 'https://all-wish.me',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
          }
        });
      } catch (err) {
        console.log(`[AllWish] Server error: ${err.message}`);
      }
    }

    console.log(`[AllWish]  Returning ${streams.length} streams`);
    return streams;

  } catch (e) {
    console.log(`[AllWish]  Error: ${e.message}`);
    return [];
  }
}

// ============================================
//  Export
// ============================================

module.exports = { getStreams, scrape: getStreams };