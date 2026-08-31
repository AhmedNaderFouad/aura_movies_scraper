// src/utils/cinemetaEpisodes.js
async function getEpisodesPerSeason(imdbId) {
    try {
        const url = `https://v3-cinemeta.strem.io/catalog/series/top/${imdbId}/1.json`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        const meta = data.metas?.[0];
        if (!meta || !meta.videos) return [];
        const episodesPerSeason = [];
        const videos = meta.videos || [];
        const seasons = {};
        for (const video of videos) {
            const season = video.season || 1;
            if (!seasons[season]) seasons[season] = 0;
            seasons[season]++;
        }
        const sortedKeys = Object.keys(seasons).sort((a, b) => parseInt(a) - parseInt(b));
        for (const key of sortedKeys) {
            episodesPerSeason.push(seasons[key]);
        }
        return episodesPerSeason;
    } catch (err) {
        console.warn('[Cinemeta] Failed to fetch episodes:', err.message);
        return [];
    }
}

module.exports = { getEpisodesPerSeason };