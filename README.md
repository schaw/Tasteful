# Movie Recommendation App

A personal movie recommendation web app with search, filters, and rating integration.

## Features
- Search movies by name, year, genre
- Multiple genre selection
- Year range filtering
- IMDB & Rotten Tomatoes ratings
- Mark movies as watched (like/dislike/superlike)
- Personal watchlist
- Movie recommendations based on watch history

## Setup

1. Get API keys:
   - TMDB API: https://www.themoviedb.org/settings/api
   - OMDB API: http://www.omdbapi.com/apikey.aspx

2. Update API keys in `src/App.js`

3. Install and run:
```bash
npm install
npm start
```

4. Deploy to GitHub Pages:
```bash
npm run deploy
```

## Mobile Migration
This React app can be converted to React Native for iOS/Android apps later.

## Data Storage
- Uses localStorage for personal data (watched movies, watchlist)
- No backend required - completely client-side
