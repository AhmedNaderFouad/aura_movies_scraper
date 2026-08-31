// src/utils/titleMatch.js
function similarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) return 1;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) matches++;
    }
    return matches / longer.length;
}

function findBestMatch(target, candidates, options = {}) {
    let best = null;
    let bestScore = -1;
    const targetTitle = target.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetYear = target.year;
    for (const candidate of candidates) {
        const candidateTitle = candidate.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        let score = similarity(targetTitle, candidateTitle);
        if (targetYear && candidate.year) {
            if (parseInt(targetYear) === parseInt(candidate.year)) {
                score += 0.3;
            } else {
                score -= 0.1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    if (bestScore < 0.5) return { best: null };
    return { best };
}

async function findBestMatchWithRetry(target, variants, searchFn, options = {}) {
    let best = null;
    let bestScore = -1;
    for (const variant of variants) {
        const results = await searchFn(variant);
        if (!results || results.length === 0) continue;
        const candidates = results.map(r => ({
            title: r.title,
            year: r.year || parseInt(target.year) || undefined,
            raw: r
        }));
        const { best: match } = findBestMatch(target, candidates, options);
        if (match && match.raw) {
            return { best: match.raw };
        }
    }
    return { best: null };
}

module.exports = { similarity, findBestMatch, findBestMatchWithRetry };