// src/utils/tmdb.js
const { getTmdbApiKey } = require('./tmdbKey');

async function getDetails(type, tmdbId) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) throw new Error('TMDB API key missing');
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    return res.json();
}

async function resolveImdbId(type, tmdbId) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) throw new Error('TMDB API key missing');
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.imdb_id || null;
}

async function tmdbTitleToImdbId(title, year, type) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) return null;
    const searchType = type === 'series' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    const idUrl = `https://api.themoviedb.org/3/${searchType}/${result.id}/external_ids?api_key=${apiKey}`;
    const idRes = await fetch(idUrl);
    if (!idRes.ok) return null;
    const idData = await idRes.json();
    return idData.imdb_id || null;
}

module.exports = { getDetails, resolveImdbId, tmdbTitleToImdbId };