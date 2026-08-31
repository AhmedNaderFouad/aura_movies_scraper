// src/utils/tmdbKey.js
function getTmdbApiKey() {
    return process.env.TMDB_API_KEY || '2194dd3db7b2fbdc87cfc20cbda3b0d2';
}

module.exports = { getTmdbApiKey };