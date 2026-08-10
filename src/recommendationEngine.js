// Client-side taste profile + recommendation engine.
// Pure functions — no React, no I/O other than fetchRecommendations.
//
// Model (weighted count per dimension):
//   superlike -> +3, like -> +2, watched -> +1, dislike -> -2
// Aggregates weights per genre, language, year, director, cast.
// TMDB Discover API returns candidates; scoreCandidate() ranks them.

const ACTION_WEIGHTS = {
  superlike: 3,
  like: 2,
  watched: 1,
  dislike: -2,
};

// Extract normalized weight from a watchedMovies entry
export function ratingWeight(entry) {
  const r = typeof entry === 'object' ? entry.rating : entry;
  return ACTION_WEIGHTS[r] ?? 0;
}

// ----------------------------------------------------------------------------
// Build a taste profile from rated movies + moviesDatabase metadata
// ----------------------------------------------------------------------------
export function computeTasteProfile(watchedMovies, moviesDatabase) {
  const profile = {
    typeWeight: { movie: 0, tv: 0 },
    positiveTypeWeight: { movie: 0, tv: 0 },
    genreWeights: {},
    genreNames: {},
    langWeights: {},
    yearsWeighted: [],
    directorWeights: {},
    directorIdWeights: {},
    castWeights: {},
    castIdWeights: {},
    totalRatedCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    yearMean: null,
    yearSpread: null,
  };

  Object.entries(watchedMovies || {}).forEach(([movieId, entry]) => {
    const weight = ratingWeight(entry);
    if (weight === 0) return; // unknown rating string — skip

    // Count EVERY rated movie for totalRatedCount, even if moviesDatabase entry is missing
    // (legacy ratings may pre-date rich metadata storage — still show them as evidence of taste)
    profile.totalRatedCount++;
    // "% liked" should reflect explicit thumbs — plain 'watched' is neutral (neither liked nor disliked)
    const ratingStr = typeof entry === 'object' ? entry?.rating : entry;
    const isThumbsUp = ratingStr === 'like' || ratingStr === 'superlike';
    const isThumbsDown = ratingStr === 'dislike';
    if (isThumbsUp) profile.positiveCount++;
    else if (isThumbsDown) profile.negativeCount++;

    const meta = moviesDatabase?.[movieId];
    if (!meta) {
      // No metadata — count the rating but skip dimensional contribution
      profile.missingMetadataCount = (profile.missingMetadataCount || 0) + 1;
      return;
    }

    // Media type — track BOTH signed and positive-only totals
    // Signed goes into typeWeight (used for scoring); positive-only drives movieBias/tvBias
    // so a user with 5 liked shows + 8 disliked shows still gets some TV recs.
    const mt = meta.mediaType || 'movie';
    profile.typeWeight[mt] = (profile.typeWeight[mt] || 0) + weight;
    if (weight > 0) {
      profile.positiveTypeWeight[mt] = (profile.positiveTypeWeight[mt] || 0) + weight;
    }

    // Genres — support BOTH storage shapes:
    //   1. `genre_ids: [28, 878]` + `genres: ['Action', 'Sci-Fi']` (parallel arrays)
    //   2. `genres: [{id: 28, name: 'Action'}, ...]` (TMDB raw shape)
    let genrePairs = []; // [[id, name], ...]
    if (Array.isArray(meta.genre_ids) && meta.genre_ids.length > 0) {
      genrePairs = meta.genre_ids.map((id, idx) => {
        const name = Array.isArray(meta.genres)
          ? (typeof meta.genres[idx] === 'string' ? meta.genres[idx] : meta.genres[idx]?.name)
          : null;
        return [id, name];
      });
    } else if (Array.isArray(meta.genres) && meta.genres.length > 0 && typeof meta.genres[0] === 'object') {
      genrePairs = meta.genres.map((g) => [g.id, g.name]);
    }
    genrePairs.forEach(([gId, gName]) => {
      if (gId == null) return;
      const key = String(gId);
      profile.genreWeights[key] = (profile.genreWeights[key] || 0) + weight;
      if (gName) profile.genreNames[key] = gName;
    });

    // Language
    if (meta.language) {
      profile.langWeights[meta.language] = (profile.langWeights[meta.language] || 0) + weight;
    }

    // Year — accept several field shapes
    const y = meta.year
      || (meta.releaseDate ? parseInt(String(meta.releaseDate).slice(0, 4), 10) : null)
      || (meta.release_date ? parseInt(String(meta.release_date).slice(0, 4), 10) : null);
    if (y && !isNaN(y)) profile.yearsWeighted.push([y, weight]);

    // Directors (names + ids)
    (meta.directors || []).forEach((n) => {
      const name = typeof n === 'string' ? n : n?.name;
      if (name) profile.directorWeights[name] = (profile.directorWeights[name] || 0) + weight;
    });
    (meta.director_ids || []).forEach((id) => {
      profile.directorIdWeights[id] = (profile.directorIdWeights[id] || 0) + weight;
    });

    // Cast (top 5)
    (meta.cast || []).slice(0, 5).forEach((n) => {
      const name = typeof n === 'string' ? n : n?.name;
      if (name) profile.castWeights[name] = (profile.castWeights[name] || 0) + weight;
    });
    (meta.cast_ids || []).slice(0, 5).forEach((id) => {
      profile.castIdWeights[id] = (profile.castIdWeights[id] || 0) + weight;
    });
  });

  // Year mean + weighted std
  if (profile.yearsWeighted.length > 0) {
    const posYears = profile.yearsWeighted.filter(([, w]) => w > 0);
    const useYears = posYears.length > 0 ? posYears : profile.yearsWeighted.map(([y, w]) => [y, Math.abs(w)]);
    const totalW = useYears.reduce((s, [, w]) => s + Math.abs(w), 0);
    profile.yearMean = useYears.reduce((s, [y, w]) => s + y * Math.abs(w), 0) / totalW;
    const variance = useYears.reduce(
      (s, [y, w]) => s + Math.pow(y - profile.yearMean, 2) * Math.abs(w),
      0,
    ) / totalW;
    profile.yearSpread = Math.max(5, Math.sqrt(variance));
  }

  // Top items (for query fanout + display)
  profile.topGenres = Object.entries(profile.genreWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => parseInt(id, 10))
    .filter((id) => !isNaN(id));

  profile.dislikedGenres = Object.entries(profile.genreWeights)
    .filter(([, w]) => w < 0)
    .map(([id]) => parseInt(id, 10))
    .filter((id) => !isNaN(id));

  profile.topLanguages = Object.entries(profile.langWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang]) => lang);

  profile.topDirectors = Object.entries(profile.directorWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  profile.topCast = Object.entries(profile.castWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  profile.topDirectorIds = Object.entries(profile.directorIdWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  profile.topCastIds = Object.entries(profile.castIdWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // Type bias — fair for mixed-taste users (a user who likes 5 shows AND
  // dislikes 8 shows still gets some TV recs; using positive-only weights
  // avoids collapsing tvBias to 0 in that case)
  const posMovie = profile.positiveTypeWeight.movie || 0;
  const posTv = profile.positiveTypeWeight.tv || 0;
  const total = posMovie + posTv;
  profile.movieBias = total > 0 ? posMovie / total : 0.5;
  profile.tvBias = total > 0 ? posTv / total : 0.5;

  return profile;
}

// ----------------------------------------------------------------------------
// Score a single candidate against a profile
// ----------------------------------------------------------------------------
export function scoreCandidate(candidate, profile) {
  const λ = {
    genre: 1.0,
    year: 0.5,
    lang: 0.6,
    rating: 0.4,
    director: 2.0,   // applied via _personMatch — see below
    popularity: 0.2,
  };

  let score = 0;

  // Genre alignment — read with String(id) to match how genreWeights are stored
  (candidate.genre_ids || []).forEach((gId) => {
    const w = profile.genreWeights[String(gId)];
    if (w) score += w * λ.genre;
  });

  // Year proximity (bell around user's mean year)
  const yearStr = candidate.release_date || candidate.first_air_date;
  const year = yearStr ? parseInt(String(yearStr).slice(0, 4), 10) : null;
  if (year && profile.yearMean && profile.yearSpread) {
    const dist = Math.abs(year - profile.yearMean);
    const proximity = Math.max(0, 1 - dist / (profile.yearSpread * 2));
    score += proximity * λ.year * 5;
  }

  // Language
  const lang = candidate.original_language;
  if (lang && profile.langWeights[lang]) {
    score += profile.langWeights[lang] * λ.lang;
  }

  // TMDB rating (normalized around 6.0, only when vote_count is meaningful)
  if (candidate.vote_average != null && (candidate.vote_count || 0) > 50) {
    score += ((candidate.vote_average - 6) / 4) * λ.rating * 3;
  }

  // Director bonus — candidate came from the with_people query, so we know it
  // includes one of the user's top directors. Boost proportionally to the sum
  // of positive director weights (bigger boost the more of that director's
  // work the user has enjoyed).
  if (candidate._personMatch) {
    const dirBoost = profile.topDirectorIds
      .slice(0, 2)
      .reduce((s, id) => s + (profile.directorIdWeights[id] || 0), 0);
    score += dirBoost * λ.director;
  }

  // Small popularity tie-breaker so ties don't collapse deterministically
  if (candidate.popularity) {
    score += Math.log10(candidate.popularity + 1) * λ.popularity;
  }

  return score;
}

// ----------------------------------------------------------------------------
// Fetch + score recommendations from TMDB Discover
// ----------------------------------------------------------------------------
export async function fetchRecommendations(profile, apiKey, options = {}) {
  const {
    watchedKeys = new Set(),      // Set of "<mediaType>-<id>" strings
    watchlistKeys = new Set(),
    hideWatchlisted = false,
    target = 12,
    mediaTypeFilter = 'all', // 'all' | 'movie' | 'tv'
    signal,                  // AbortController.signal — cancels in-flight fetches
    page = 1,                // TMDB Discover page (1..500) — cycled on Refresh for variety
  } = options;

  if (profile.totalRatedCount === 0) return { items: [], queriesRun: 0 };

  // Detect a "thin" profile — user has rated things, but we don't have
  // enough metadata to build a directed Discover query (no genres AND no year).
  // Fall back to /trending so we ALWAYS return content.
  const thinProfile = profile.topGenres.length === 0 && !profile.yearMean;
  if (thinProfile) {
    return fetchTrendingFallback(apiKey, {
      watchedKeys,
      watchlistKeys,
      hideWatchlisted,
      target,
      mediaTypeFilter,
      signal,
      page,
    });
  }

  // Year window: profile mean ± 2 * spread, clamped
  const currentYear = new Date().getFullYear();
  const yearMin = profile.yearMean
    ? Math.max(1950, Math.floor(profile.yearMean - profile.yearSpread * 2))
    : 2000;
  const yearMax = profile.yearMean
    ? Math.min(currentYear + 1, Math.ceil(profile.yearMean + profile.yearSpread * 2))
    : currentYear;

  const langParam = profile.topLanguages.length > 0
    ? `&with_original_language=${profile.topLanguages[0]}`
    : '';

  const withoutGenres = profile.dislikedGenres.length > 0
    ? `&without_genres=${profile.dislikedGenres.join(',')}`
    : '';

  // Build genre "queries" — top 3 solo + top-2 as OR pair for diversity
  const topGenres = profile.topGenres.slice(0, 3);
  const genreCombos = [];
  topGenres.forEach((g) => genreCombos.push(String(g)));
  if (topGenres.length >= 2) genreCombos.push(`${topGenres[0]},${topGenres[1]}`);
  if (genreCombos.length === 0) genreCombos.push(''); // no genre constraint

  const queries = [];
  const buildUrl = (kind, genreStr, pageNum) => {
    const dateGte = kind === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const dateLte = kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
    return `https://api.themoviedb.org/3/discover/${kind}?api_key=${apiKey}`
      + (genreStr ? `&with_genres=${genreStr}` : '')
      + `&${dateGte}=${yearMin}-01-01`
      + `&${dateLte}=${yearMax}-12-31`
      + `&sort_by=vote_count.desc`
      + `&vote_count.gte=100`
      + `&page=${pageNum}`
      + langParam
      + withoutGenres;
  };

  const doMovie = mediaTypeFilter !== 'tv' && profile.movieBias > 0.15;
  const doTv = mediaTypeFilter !== 'movie' && profile.tvBias > 0.15;

  // Fetch the requested page for each genre combo. On the FIRST page (initial
  // load), also fetch the next page for the top-1 genre — doubles the starter
  // pool so users don't run out of picks after rating just a few.
  const nextPage = page + 1;
  genreCombos.forEach((g, idx) => {
    if (doMovie) queries.push({ url: buildUrl('movie', g, page), mediaType: 'movie', personMatch: false });
    if (doTv)    queries.push({ url: buildUrl('tv',    g, page), mediaType: 'tv',    personMatch: false });
    // Extra page for the primary (top-1) genre combo, but only on page 1
    // (avoids ballooning API calls when user keeps hitting Refresh)
    if (idx === 0 && page === 1) {
      if (doMovie) queries.push({ url: buildUrl('movie', g, nextPage), mediaType: 'movie', personMatch: false });
      if (doTv)    queries.push({ url: buildUrl('tv',    g, nextPage), mediaType: 'tv',    personMatch: false });
    }
  });

  // Person-based query — if we have a top director, fetch their movies.
  // Also uses the paged offset so Refresh cycles their catalog too.
  if (profile.topDirectorIds.length > 0 && doMovie) {
    const dirIds = profile.topDirectorIds.slice(0, 2).join('|');
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}`
      + `&with_people=${dirIds}`
      + `&sort_by=vote_count.desc`
      + `&page=${page}`;
    queries.push({ url, mediaType: 'movie', personMatch: true });
  }

  // Fire all in parallel, honoring abort signal so a stale fetch doesn't burn API budget
  const settled = await Promise.allSettled(
    queries.map(({ url, mediaType, personMatch }) =>
      fetch(url, { signal })
        .then((r) => r.json())
        .then((data) => ({ mediaType, personMatch, items: data.results || [] })),
    ),
  );

  // Merge unique — key by mediaType-id, NOT bare id, because TMDB Movie IDs
  // and TV IDs live in separate namespaces (Movie 550 and TV 550 both exist).
  const candidates = new Map();
  settled.forEach((res) => {
    if (res.status !== 'fulfilled') return;
    const { mediaType, personMatch, items } = res.value;
    items.forEach((item) => {
      const key = `${mediaType}-${item.id}`;
      if (!candidates.has(key)) {
        candidates.set(key, { ...item, media_type: mediaType, _personMatch: personMatch });
      } else if (personMatch) {
        // Elevate existing entry if this query flagged it as a person match
        candidates.get(key)._personMatch = true;
      }
    });
  });

  // Filter + score using composite media-type-aware keys
  const scored = [];
  candidates.forEach((c) => {
    const key = `${c.media_type}-${c.id}`;
    if (watchedKeys.has(key)) return;
    if (hideWatchlisted && watchlistKeys.has(key)) return;
    // Enforce media-type filter locally too (defensive — the query fanout already respects it)
    if (mediaTypeFilter !== 'all' && c.media_type !== mediaTypeFilter) return;
    const s = scoreCandidate(c, profile);
    scored.push({ ...c, _score: s });
  });

  scored.sort((a, b) => b._score - a._score);

  // ──── PROGRESSIVE EXPANSION ────
  // If we didn't fill the target, try up to 3 more expansion passes:
  //   Pass 1: Advance to pages 2+3 with same filters (broader catalog)
  //   Pass 2: Drop language constraint (international content)
  //   Pass 3: Widen year window by ±10 years (older/newer)
  // Each pass fires ~4 extra TMDB calls. Total max: ~12 extra on top of initial ~8.
  if (scored.length < target && !signal?.aborted) {
    const expansionPasses = [
      { pages: [page + 1, page + 2], lang: langParam, yearMinE: yearMin, yearMaxE: yearMax },
      { pages: [page], lang: '', yearMinE: yearMin, yearMaxE: yearMax },
      { pages: [page], lang: '', yearMinE: Math.max(1950, yearMin - 10), yearMaxE: Math.min(currentYear + 1, yearMax + 10) },
    ];

    for (const pass of expansionPasses) {
      if (scored.length >= target || signal?.aborted) break;

      const expandQueries = [];
      const buildExpandUrl = (kind, genreStr, pg) => {
        const dateGte = kind === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
        const dateLte = kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
        return `https://api.themoviedb.org/3/discover/${kind}?api_key=${apiKey}`
          + (genreStr ? `&with_genres=${genreStr}` : '')
          + `&${dateGte}=${pass.yearMinE}-01-01`
          + `&${dateLte}=${pass.yearMaxE}-12-31`
          + `&sort_by=vote_count.desc`
          + `&vote_count.gte=50`
          + `&page=${pg}`
          + pass.lang
          + withoutGenres;
      };

      for (const pg of pass.pages) {
        // Use only the top 2 genre combos for expansion (avoids ballooning calls)
        genreCombos.slice(0, 2).forEach((g) => {
          if (doMovie) expandQueries.push({ url: buildExpandUrl('movie', g, pg), mediaType: 'movie' });
          if (doTv)    expandQueries.push({ url: buildExpandUrl('tv', g, pg), mediaType: 'tv' });
        });
      }

      const expandSettled = await Promise.allSettled(
        expandQueries.map(({ url, mediaType }) =>
          fetch(url, { signal })
            .then((r) => r.json())
            .then((data) => ({ mediaType, items: data.results || [] })),
        ),
      );

      expandSettled.forEach((res) => {
        if (res.status !== 'fulfilled') return;
        const { mediaType, items } = res.value;
        items.forEach((item) => {
          const key = `${mediaType}-${item.id}`;
          if (candidates.has(key)) return; // already seen
          if (watchedKeys.has(key)) return;
          if (hideWatchlisted && watchlistKeys.has(key)) return;
          if (mediaTypeFilter !== 'all' && mediaType !== mediaTypeFilter) return;
          candidates.set(key, { ...item, media_type: mediaType, _personMatch: false });
          const s = scoreCandidate({ ...item, media_type: mediaType, _personMatch: false }, profile);
          scored.push({ ...item, media_type: mediaType, _personMatch: false, _score: s });
        });
      });

      // Re-sort after each expansion pass
      scored.sort((a, b) => b._score - a._score);
    }
  }
  // ──── END PROGRESSIVE EXPANSION ────

  // If Discover returned nothing (highly restrictive filters, or all candidates already watched),
  // fall back to /trending so the page is never empty.
  if (scored.length === 0) {
    const fb = await fetchTrendingFallback(apiKey, {
      watchedKeys,
      watchlistKeys,
      hideWatchlisted,
      target,
      mediaTypeFilter,
      signal,
      page,
    });
    return { ...fb, queriesRun: queries.length + fb.queriesRun, fallbackUsed: true };
  }

  return {
    items: scored.slice(0, target),
    queriesRun: queries.length,
    totalCandidates: candidates.size,
  };
}

// ----------------------------------------------------------------------------
// Trending fallback — when the profile is too thin to build a directed query
// OR when Discover returned no unwatched candidates.
// ----------------------------------------------------------------------------
async function fetchTrendingFallback(apiKey, opts) {
  const { watchedKeys, watchlistKeys, hideWatchlisted, target, mediaTypeFilter, signal, page = 1 } = opts;
  const kind = mediaTypeFilter === 'tv' ? 'tv' : mediaTypeFilter === 'movie' ? 'movie' : 'all';
  const url = `https://api.themoviedb.org/3/trending/${kind}/week?api_key=${apiKey}&page=${page}`;

  try {
    const res = await fetch(url, { signal });
    const data = await res.json();
    const items = (data.results || [])
      .map((c) => ({ ...c, media_type: c.media_type || (kind !== 'all' ? kind : 'movie') }))
      .filter((c) => !watchedKeys.has(`${c.media_type}-${c.id}`))
      .filter((c) => !(hideWatchlisted && watchlistKeys.has(`${c.media_type}-${c.id}`)))
      .slice(0, target);
    return {
      items,
      queriesRun: 1,
      totalCandidates: data.results?.length || 0,
      fallbackUsed: true,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { items: [], queriesRun: 1, totalCandidates: 0, fallbackUsed: true, error: e.message };
  }
}

// ----------------------------------------------------------------------------
// Human-readable summary of the taste profile
// ----------------------------------------------------------------------------
export function formatProfileSummary(profile) {
  if (!profile || profile.totalRatedCount === 0) return null;

  const parts = [];

  // Media type
  if (profile.movieBias > 0.7) parts.push('Movies');
  else if (profile.tvBias > 0.7) parts.push('Shows');
  else parts.push('Movies & Shows');

  // Top genres (up to 3)
  const topGenreNames = profile.topGenres.slice(0, 3)
    .map((id) => profile.genreNames[String(id)])
    .filter(Boolean);
  if (topGenreNames.length > 0) parts.push(topGenreNames.join(' + '));

  // Year era
  if (profile.yearMean) {
    const y = Math.round(profile.yearMean);
    const now = new Date().getFullYear();
    if (y >= now - 5) parts.push('recent');
    else if (y >= 2010) parts.push(`${Math.floor(y / 10) * 10}s`);
    else if (y >= 2000) parts.push('2000s');
    else parts.push(`pre-${Math.floor(y / 10) * 10 + 10}`);
  }

  // Language
  if (profile.topLanguages.length > 0 && profile.topLanguages[0] !== 'en') {
    const langMap = {
      hi: 'Hindi', te: 'Telugu', ta: 'Tamil', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali',
      gu: 'Gujarati', mr: 'Marathi', pa: 'Punjabi', ur: 'Urdu',
      ja: 'Japanese', ko: 'Korean', zh: 'Chinese', th: 'Thai', vi: 'Vietnamese',
      es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', de: 'German',
      ru: 'Russian', ar: 'Arabic', tr: 'Turkish',
    };
    const l = langMap[profile.topLanguages[0]] || profile.topLanguages[0].toUpperCase();
    parts.push(l);
  }

  return parts.join(' · ');
}
