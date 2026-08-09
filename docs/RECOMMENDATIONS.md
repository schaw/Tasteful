# Tasteful — Recommendation Engine

**Location:** [`src/recommendationEngine.js`](../src/recommendationEngine.js)
**Consumer:** [`MyContentView` in `src/App.js`](../src/App.js)
**Status:** v1 — statistical (no ML libraries, no server, no training data)

---

## What it is

A client-side taste model + TMDB Discover fanout that turns the user's rating
history into a ranked list of personalized recommendations. Runs entirely in
the browser in under a second. No cost, no keys beyond the existing TMDB key.

---

## The three phases

```
  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐
  │  Phase 1        │   │  Phase 2         │   │  Phase 3        │
  │  Build profile  │─▶│  Fetch candidates│─▶│  Score & rank   │
  │  (pure, O(N))   │   │  (~5 TMDB calls) │   │  (pure, O(C))   │
  └─────────────────┘   └──────────────────┘   └─────────────────┘
         │                        │                       │
         ▼                        ▼                       ▼
   `computeTasteProfile`   `fetchRecommendations`    `scoreCandidate`
```

---

## Phase 1 — Build the taste profile

### Input
- `watchedMovies`: `{ movieId: { rating: 'like'|'dislike'|'superlike'|'watched', ratedAt } }`
- `moviesDatabase`: `{ movieId: { title, genre_ids, genres, year, language, cast, directors, cast_ids, director_ids, mediaType, ... } }`

### Weights per rating action

| Action     | Weight |
|------------|:------:|
| superlike  | **+3** |
| like       | **+2** |
| watched    | **+1** |
| dislike    | **−2** |

### Dimensions aggregated

For every rated movie found in `moviesDatabase`, we add its weight to each of:

| Dimension       | What we accumulate                                                                   |
|-----------------|--------------------------------------------------------------------------------------|
| **Content type**| `typeWeight.movie` vs `typeWeight.tv` → determines movie/TV query split              |
| **Genres**      | `genreWeights[genre_id]` (positive = liked, negative = disliked)                     |
| **Language**    | `langWeights[lang_code]` → top language becomes `with_original_language` filter      |
| **Year**        | `yearsWeighted.push([year, weight])` → later reduced to weighted mean + spread       |
| **Directors**   | `directorWeights[name]` + `directorIdWeights[tmdb_person_id]`                        |
| **Cast**        | `castWeights[name]` + `castIdWeights[tmdb_person_id]` (top 5 per movie)              |

### Derived signals

After the loop, we compute:

- `yearMean` — weighted arithmetic mean of years user liked
- `yearSpread` — `max(5, sqrt(weightedVariance))` — used to build a Discover date window of `mean ± 2·spread`
- `topGenres` — the 5 highest positive genre IDs (drives query fanout)
- `dislikedGenres` — negative-weighted genre IDs (drives `without_genres` exclusion)
- `topLanguages`, `topDirectors`, `topCast`, `topDirectorIds`, `topCastIds`
- `movieBias` / `tvBias` — normalized ratio of positive movie vs TV weight (0.0–1.0)
- `totalRatedCount`, `positiveCount`, `negativeCount` — for the profile-summary card

### Metadata-missing safety

If a movie in `watchedMovies` has no matching entry in `moviesDatabase` (common
for ratings made before rich metadata was captured), it **still counts toward
`totalRatedCount`** — but contributes zero dimensional weight. This means the
"Build your taste" empty state doesn't false-fire, and we know how many items
are missing metadata (`profile.missingMetadataCount`).

---

## Phase 2 — Fetch candidates from TMDB

### Query fanout

We fire **~5-8 parallel HTTP requests** to
[`/discover/movie`](https://developer.themoviedb.org/reference/discover-movie)
and
[`/discover/tv`](https://developer.themoviedb.org/reference/discover-tv):

| Query                                                 | Purpose                          |
|-------------------------------------------------------|----------------------------------|
| Discover movie with top genre 1                       | Solo pick of best genre          |
| Discover movie with top genre 2                       | Diversify by 2nd genre           |
| Discover movie with top genre 3                       | Diversify by 3rd genre           |
| Discover movie with `top-genre-1,top-genre-2` (OR)    | Broader pool bridging two        |
| Discover TV with each of the above (if `tvBias > 0.15`)| Include shows when user watches TV |
| Discover movie `with_people=directorId1|directorId2`  | Boost known-loved directors      |

All queries share these filters:
```
sort_by=vote_count.desc               ← quality proxy (avoids obscure noise)
vote_count.gte=100
primary_release_date.gte=<yearMin>    ← yearMean − 2·spread (clamped ≥ 1950)
primary_release_date.lte=<yearMax>    ← yearMean + 2·spread (clamped ≤ current+1)
with_original_language=<topLang>      ← if user has a clear language preference
without_genres=<dislikedGenres>       ← never surface things they disliked
```

Requests are fired via `Promise.allSettled` so one failure doesn't sink the
batch. Results are merged into a `Map<id, candidate>` for dedupe.

### Thin-profile fallback

If the profile has **no `topGenres` and no `yearMean`** (e.g., the user just
signed in on a new device, or every rated movie is missing metadata), we
short-circuit to
[`/trending/{movie|tv|all}/week`](https://developer.themoviedb.org/reference/trending-all)
so the page is **never empty**. The UI shows a small "Showing trending — rate
more items for taste-matched picks" hint when this fallback fires.

### Post-fetch empty-guard

If Discover returns zero unwatched candidates (all matches already watched, or
filters were too restrictive), we also fall back to trending before returning
so the grid always has something to show.

---

## Phase 3 — Score & rank

Each candidate is scored by the pure `scoreCandidate(candidate, profile)`
function:

```
score =   Σ (candidate.genre_ids ∩ profile.genreWeights)      · λ_genre       // 1.0
        + max(0, 1 − |year − profile.yearMean| / (2·spread))  · λ_year · 5    // 0.5
        + profile.langWeights[candidate.original_language]    · λ_lang        // 0.6
        + (candidate.vote_average − 6) / 4                    · λ_rating · 3  // 0.4  (only if vote_count > 50)
        + log10(candidate.popularity + 1)                     · λ_pop         // 0.2  (tie-breaker)
```

### Tunable λ weights (in `scoreCandidate`)

| λ            | Value | Rationale                                               |
|--------------|:-----:|---------------------------------------------------------|
| `λ_genre`    | 1.0   | Primary signal — genre alignment matters most           |
| `λ_year`     | 0.5   | Users have era preferences but not narrow ones           |
| `λ_lang`     | 0.6   | Language is a strong secondary filter                    |
| `λ_rating`   | 0.4   | TMDB rating is noisy — moderate weight                   |
| `λ_director` | 2.0   | Not yet used in scoring — reserved for future boost      |
| `λ_cast`     | 1.0   | Not yet used in scoring — reserved for future boost      |
| `λ_pop`      | 0.2   | Small tie-breaker so equal scores don't collapse         |

### Filtering rules (before scoring)

1. Drop any candidate whose ID is in `watchedIds` (already rated/watched)
2. Drop watchlisted candidates **only if** `hideWatchlisted === true`
3. Enforce `mediaTypeFilter` (`all` / `movie` / `tv`) locally as a safety net

### Ranking

Sort by `_score` descending, take `target` (default 24).

---

## What the user sees

### Profile card (top of `MyContentView`)

- **Hero title:** *Made for you* (italic Playfair serif)
- **Tagline:** `formatProfileSummary(profile)` — e.g., `Movies · Sci-Fi + Action + Adventure · recent · English`
- **Stats:** `X rated | Y% liked | avg year Z`
- **People chips:** top 3 directors + top 4 cast (clickable → jump to search)

### Controls row

- Count: `24 recommendations`
- Meta hint: `Screened 89 candidates` (or the fallback hint)
- Toggle: **Hide watchlisted**
- Button: **↻ Refresh**

### Grid

Standard `MovieCard` grid, identical to the Home page. Every card retains full
rate/watchlist/watched functionality, so rating from My Content immediately
updates the taste profile for the next Refresh.

---

## Cost & performance

| Metric                          | Value                                            |
|---------------------------------|--------------------------------------------------|
| Profile build                   | O(N) where N = rated items. ~5 ms for 200 items. |
| TMDB API calls per Refresh      | 5–8 (fire-and-forget parallel `Promise.allSettled`) |
| TMDB rate limit                 | 40 req / 10 s (well within budget)               |
| Scoring pass                    | O(C·D) — C ≈ 100 candidates, D ≈ 8 dimensions    |
| Total end-to-end latency        | Typically < 800 ms                               |
| Bundle-size delta               | +4 KB gzipped (engine + view)                    |

---

## Future ideas (not yet implemented)

- **Director/Cast score boost** — currently we query `with_people` for TMDB
  Discover but don't add director/cast weights into the score. `λ_director`
  and `λ_cast` are reserved for this.
- **Recency decay** — a rating from 2 years ago shouldn't count as much as a
  rating from last week. Multiply weight by `exp(-Δdays / halflife)`.
- **Serendipity slot** — reserve N of the target slots for high-popularity
  content in genres the user has *not* rated, to expand taste rather than
  reinforce it.
- **Feedback loop** — track which recommended items the user clicks / rates,
  update λ weights against a per-user regression.
- **Explain each pick** — on hover, show "recommended because you liked
  Nolan + high year proximity". The `_score` breakdown is there — just needs
  UI plumbing.
- **Backfill missing metadata** — when the user opens `MyContentView`, kick
  off a lazy background job to fetch TMDB metadata for any rated movie whose
  `moviesDatabase` entry is missing/thin. Would fold `missingMetadataCount`
  → 0 over time.

---

## Testing checklist

- [ ] User with 0 ratings → sees "Build your taste" copy
- [ ] User with 5+ ratings all missing `moviesDatabase` → sees trending fallback + "rate more items" hint
- [ ] User with a strong genre preference → recs match that genre
- [ ] User with only movies rated → no TV shows in recs
- [ ] User with rated movies + `hideWatchlisted=true` → no watchlisted items appear
- [ ] Refresh button → fires new TMDB calls (may re-return same items, that's fine)
- [ ] Rating a recommendation card → the item's card updates its state; next Refresh reflects the new rating
- [ ] Media-type filter (All / Movies / Shows) → recs respect the toggle
