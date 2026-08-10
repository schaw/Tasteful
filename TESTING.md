# Tasteful — Pre-Deploy Testing Checklist

Run through this **before every `npm run deploy`**. Takes 5 minutes.

---

## Desktop (Chrome, any wide screen)

| # | Test | Expected |
|---|------|----------|
| 1 | Load Home signed out | Hero, search bar, 40 titles, 4+ cards per row, no horizontal scroll |
| 2 | Sign in (Google popup) | Redirects back, name/avatar visible, Backup button appears |
| 3 | Search "Inception" | Results appear, clicking card opens details modal |
| 4 | Rate a movie (👍 then ❤️) | Icon fills immediately, history updates, no lag |
| 5 | Watchlist a movie (♡) | Heart fills black (light) or white (dark) instantly |
| 6 | Toggle dark mode (☀/🌙) | Full theme swap, no flash, persists on reload |
| 7 | Click Filters | Panel expands with genres/year/rating/language |
| 8 | Navigate to My Content | Profile card + grid of 12+ recommendations |
| 9 | Click Refresh on My Content | Different titles appear (page advances) |
| 10 | Toggle "Hide watchlisted" | Instant (no spinner), watchlisted cards vanish |
| 11 | Click a director chip in profile | Navigates to Home + search for that director |
| 12 | Resize to narrow (<768px) | Nav wraps to row 2, cards go to 2-col then 1-col, no horizontal scroll |
| 13 | Country flag dropdown | Changes flag emoji, persists on reload |

## Mobile (real device or Chrome DevTools → iPhone 14 / Pixel 7)

| # | Test | Expected |
|---|------|----------|
| M1 | Load page | No horizontal scroll at all — no "give" on swipe left/right |
| M2 | Sign in | Full-page redirect (not popup), returns to app signed in |
| M3 | Rate a movie | Instant tap response, no 300ms delay |
| M4 | Double-tap a card | Does NOT zoom in (touch-action: manipulation) |
| M5 | Scroll rapidly after rating | Page doesn't freeze or crash |
| M6 | Country flag visible in header | Compact flag icon (no text label) |
| M7 | Filter chips wrap | All/Movies/Shows + Rated/Watchlisted/Watched visible, centered |
| M8 | My Content grid | Cards fill width, 1-2 per row, no side gutters |
| M9 | Sign out → Sign in again | No stuck loading state |

## Regression-prone areas (check if touching these files)

| File | Risk area |
|------|-----------|
| `dataSync.js` | Data wipe on empty-map sync, cross-account contamination |
| `AuthComponent.js` | Mobile sign-in redirect vs popup |
| `Theme.css` @media | Country selector visibility, nav layout, card grid columns |
| `recommendationEngine.js` | Empty results, progressive expansion, page cycling |
| `App.css` `.App` container | Horizontal overflow, side padding |

## How to test on real phone

Local server binds to `0.0.0.0:9999`. From any device on the same network:

```
http://dev-dsk-kritek-1c-02c2425e.eu-west-1.amazon.com:9999/Tasteful/
```

If that hostname doesn't resolve from your phone, use the IP:
```bash
hostname -I | awk '{print $1}'   # get the dev desktop's IP
```

Then navigate to `http://<IP>:9999/Tasteful/`.

**Note**: Firebase Google sign-in won't work on the dev server URL (it's not in Firebase authorized domains). Test sign-in on the live deployed site only: https://schaw.github.io/Tasteful/

---

## Quick smoke test (2 min, absolute minimum before deploy)

1. `npm run build` passes with 0 errors and 0 warnings
2. Serve locally, open in browser, sign in, rate one movie → response is instant
3. Open My Content → shows 12+ recommendations
4. Resize to phone width → no horizontal scroll, no layout break
