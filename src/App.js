import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { syncUserData, getUserData, migrateLocalStorageToFirebase, removeFromCollection, exportUserDataBackup, importUserDataBackup } from './dataSync';
import { computeTasteProfile, fetchRecommendations, formatProfileSummary } from './recommendationEngine';
import AuthComponent from './AuthComponent';
import './App.css';
import './Theme.css';

const TMDB_API_KEY = process.env.REACT_APP_TMDB_API_KEY || '692135011495791f35e255a0b941a6e9';
const OMDB_API_KEY = process.env.REACT_APP_OMDB_API_KEY || '9b24abc';

function App() {
  const [movies, setMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchCategory, setSearchCategory] = useState('Movie');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const currentYear = new Date().getFullYear();
  const [yearRange, setYearRange] = useState({ min: 2000, max: currentYear });
  const [selectedRating, setSelectedRating] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [language, setLanguage] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [searchScope, setSearchScope] = useState({
    ratedOnly: false,
    watchlistedOnly: false,
    watchedOnly: false
  });
  const [currentView, setCurrentView] = useState('home');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [showMoreButton, setShowMoreButton] = useState(false);
  const [genresPerTwoRows, setGenresPerTwoRows] = useState(12);
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  // Close mobile settings menu when clicking outside
  useEffect(() => {
    if (!showMobileSettings) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.mobile-settings-wrapper')) {
        setShowMobileSettings(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showMobileSettings]);

  const [directorSearch, setDirectorSearch] = useState(null);
  const [castSearch, setCastSearch] = useState(null);
  const [genreSearch, setGenreSearch] = useState(null);
  const [languageSearch, setLanguageSearch] = useState(null);
  const [sortBy, setSortBy] = useState('popularity');
  const [sortedMovies, setSortedMovies] = useState([]);
  const [isSorting, setIsSorting] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [lastHomeClick, setLastHomeClick] = useState(0);
  const [mediaType, setMediaType] = useState('all'); // 'all' | 'movie' | 'tv'
  const [selectedCountry, setSelectedCountry] = useState('US');
  const [excludeTalkShows, setExcludeTalkShows] = useState(true);

  // Shared item state — populated from URL hash like #/movie/550
  const [sharedItem, setSharedItem] = useState(null);

  // Authentication state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false); // Guards localStorage writes until real data is loaded

  // Theme state — initialized from what the pre-mount script set on <html>
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') {
      return 'dark';
    }
    return 'light';
  });

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
  };

  // Respond to system preference changes only if user hasn't set an explicit choice
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      try { if (localStorage.getItem('theme')) return; } catch (err) { return; }
      const next = e.matches ? 'dark' : 'light';
      setTheme(next);
      if (next === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Deep link router: reads URL hash like #/movie/550 or #/tv/1396
  useEffect(() => {
    const parseHash = async () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/(movie|tv)\/(\d+)$/);
      if (!match) return;
      const [, type, id] = match;
      try {
        const appendExtra = type === 'tv' ? ',content_ratings' : ',release_dates';
        const [res, wpRes] = await Promise.all([
          fetch(`https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits${appendExtra}`),
          fetch(`https://api.themoviedb.org/3/${type}/${id}/watch/providers?api_key=${TMDB_API_KEY}`).catch(() => null),
        ]);
        if (!res.ok) return;
        const data = await res.json();
        const wpData = wpRes ? await wpRes.json().catch(() => ({})) : {};

        // Fetch OMDB for IMDB/RT ratings
        let omdbData = {};
        if (data.imdb_id) {
          try {
            const omdbRes = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${data.imdb_id}`);
            omdbData = await omdbRes.json();
          } catch (e) { /* OMDB optional */ }
        }

        // Extract US content rating
        let certification = null;
        if (type === 'movie' && data.release_dates?.results) {
          const us = data.release_dates.results.find(r => r.iso_3166_1 === 'US');
          certification = us?.release_dates?.find(rd => rd.certification)?.certification;
        } else if (type === 'tv' && data.content_ratings?.results) {
          const us = data.content_ratings.results.find(r => r.iso_3166_1 === 'US');
          certification = us?.rating;
        }

        setSharedItem({
          id: data.id,
          title: data.title || data.name,
          overview: data.overview,
          poster_path: data.poster_path,
          backdrop_path: data.backdrop_path,
          release_date: data.release_date || data.first_air_date,
          vote_average: data.vote_average,
          genres: data.genres,
          media_type: type,
          runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]),
          credits: data.credits,
          tagline: data.tagline,
          number_of_seasons: data.number_of_seasons,
          number_of_episodes: data.number_of_episodes,
          status: data.status,
          original_language: data.original_language,
          spoken_languages: data.spoken_languages,
          omdbData,
          certification,
          imdb_id: data.imdb_id,
          watchProviders: wpData.results || {},
        });
      } catch (e) { console.error('Deep link fetch failed', e); }
    };
    parseHash();
    window.addEventListener('hashchange', parseHash);
    return () => window.removeEventListener('hashchange', parseHash);
  }, []);

  // Provider URL mapping (standalone — used by the detail modal)
  const getModalProviderUrl = (providerName, title) => {
    const q = encodeURIComponent(title || '');
    const urls = {
      'Netflix': `https://www.netflix.com/search?q=${q}`,
      'Amazon Prime Video': `https://www.amazon.com/s?k=${q}&i=instant-video`,
      'Amazon Video': `https://www.amazon.com/s?k=${q}&i=instant-video`,
      'Disney Plus': `https://www.disneyplus.com/search/${q}`,
      'Disney+': `https://www.disneyplus.com/search/${q}`,
      'Hulu': `https://www.hulu.com/search?q=${q}`,
      'Apple TV Plus': `https://tv.apple.com/search?term=${q}`,
      'Apple TV': `https://tv.apple.com/search?term=${q}`,
      'HBO Max': `https://play.max.com/search?q=${q}`,
      'Max': `https://play.max.com/search?q=${q}`,
      'Paramount Plus': `https://www.paramountplus.com/search/?q=${q}`,
      'Paramount+': `https://www.paramountplus.com/search/?q=${q}`,
      'Peacock': `https://www.peacocktv.com/search?q=${q}`,
      'Peacock Premium': `https://www.peacocktv.com/search?q=${q}`,
      'Tubi': `https://tubitv.com/search/${q}`,
      'Crunchyroll': `https://www.crunchyroll.com/search?q=${q}`,
      'Hotstar': `https://www.hotstar.com/in/search?q=${q}`,
      'JioCinema': `https://www.jiocinema.com/search/${q}`,
      'Zee5': `https://www.zee5.com/search?q=${q}`,
      'SonyLIV': `https://www.sonyliv.com/search?q=${q}`,
      'YouTube': `https://www.youtube.com/results?search_query=${q}`,
      'Google Play Movies': `https://play.google.com/store/search?q=${q}&c=movies`,
      'Vudu': `https://www.vudu.com/content/movies/search?searchString=${q}`,
    };
    return urls[providerName] || `https://www.justwatch.com/us/search?q=${q}`;
  };

  // Open the detail modal for any movie/tv (used by card clicks + deep links)
  const openMovieModal = async (movieId, mediaType) => {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    try {
      const appendExtra = type === 'tv' ? ',content_ratings' : ',release_dates';
      const [tmdbRes, wpRes] = await Promise.all([
        fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits${appendExtra}`),
        fetch(`https://api.themoviedb.org/3/${type}/${movieId}/watch/providers?api_key=${TMDB_API_KEY}`).catch(() => null),
      ]);
      if (!tmdbRes.ok) return;
      const data = await tmdbRes.json();
      const wpData = wpRes ? await wpRes.json().catch(() => ({})) : {};

      let omdbData = {};
      if (data.imdb_id) {
        try {
          const omdbRes = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${data.imdb_id}`);
          omdbData = await omdbRes.json();
        } catch (e) { /* optional */ }
      }

      let certification = null;
      if (type === 'movie' && data.release_dates?.results) {
        const us = data.release_dates.results.find(r => r.iso_3166_1 === 'US');
        certification = us?.release_dates?.find(rd => rd.certification)?.certification;
      } else if (type === 'tv' && data.content_ratings?.results) {
        const us = data.content_ratings.results.find(r => r.iso_3166_1 === 'US');
        certification = us?.rating;
      }

      setSharedItem({
        id: data.id,
        title: data.title || data.name,
        overview: data.overview,
        poster_path: data.poster_path,
        backdrop_path: data.backdrop_path,
        release_date: data.release_date || data.first_air_date,
        vote_average: data.vote_average,
        genres: data.genres,
        media_type: type,
        runtime: data.runtime || (data.episode_run_time && data.episode_run_time[0]),
        credits: data.credits,
        tagline: data.tagline,
        number_of_seasons: data.number_of_seasons,
        number_of_episodes: data.number_of_episodes,
        status: data.status,
        original_language: data.original_language,
        spoken_languages: data.spoken_languages,
        omdbData,
        certification,
        imdb_id: data.imdb_id,
        watchProviders: wpData.results || {},
      });

      // Enrich moviesDatabase with cast/director data so watchlist/ratings search can find this movie
      const castNames = (data.credits?.cast || []).slice(0, 10).map(c => c.name);
      const directorNames = (data.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name);
      if (castNames.length > 0 || directorNames.length > 0) {
        setMoviesDatabase(prev => ({
          ...prev,
          [movieId]: {
            ...(prev[movieId] || {}),
            title: data.title || data.name,
            mediaType: type,
            genre_ids: (data.genres || []).map(g => g.id),
            language: data.original_language,
            year: parseInt((data.release_date || data.first_air_date || '').slice(0, 4)) || null,
            cast: castNames,
            directors: directorNames,
          }
        }));
      }
    } catch (e) { console.error('Failed to open modal', e); }
  };

  // Scroll to top button visibility
  useEffect(() => {
    const handleScroll = () => {
      const scrollPercent = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      setShowScrollTop(scrollPercent > 0.1);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Home button handler - double click/tap refreshes feed and resets filters
  const handleHomeClick = () => {
    const now = Date.now();
    const isDoubleClick = now - lastHomeClick < 500;
    
    if (isDoubleClick) {
      // Double click - reset everything and hard refresh
      setSearchTerm('');
      setDirectorSearch(null);
      setCastSearch(null);
      setGenreSearch(null);
      setLanguageSearch(null);
      setSelectedGenres([]);
      setSelectedLanguage('');
      setSelectedRating('');
      setMinRating(0);
      setYearRange({ min: 2000, max: new Date().getFullYear() });
      setSearchScope({ ratedOnly: false, watchlistedOnly: false, watchedOnly: false });
      setSearchCategory('Content');
      setMediaType('all');
      setCurrentPage(1);
      setCurrentView('home');
      setMovies([]); // Clear current movies
      scrollToTop();
      
      // Fetch fresh default content directly (bypass state)
      const defaultYearMin = new Date().getFullYear() - 15;
      const defaultYearMax = new Date().getFullYear();
      Promise.all([
        fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&primary_release_date.gte=${defaultYearMin}-01-01&primary_release_date.lte=${defaultYearMax}-12-31&page=1&sort_by=popularity.desc`).then(r => r.json()),
        fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&first_air_date.gte=${defaultYearMin}-01-01&first_air_date.lte=${defaultYearMax}-12-31&page=1&sort_by=popularity.desc`).then(r => r.json())
      ]).then(([movieData, tvData]) => {
        const movies = (movieData.results || []).map(m => ({ ...m, media_type: 'movie' }));
        const shows = (tvData.results || []).map(s => ({ ...s, media_type: 'tv', title: s.name, release_date: s.first_air_date }));
        const combined = [...movies, ...shows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        setMovies(combined);
      }).catch(err => console.error('Error refreshing:', err));
    } else {
      setCurrentView('home');
    }
    setLastHomeClick(now);
  };

  // Handle sorting when sortBy or movies change
  useEffect(() => {
    const handleSort = async () => {
      if (movies.length === 0) return;
      
      setIsSorting(true);
      try {
        const sorted = await sortMovies(movies, sortBy);
        setSortedMovies(sorted);
      } catch (error) {
        console.error('Error sorting movies:', error);
        setSortedMovies(movies);
      }
      setIsSorting(false);
    };
    
    handleSort();
  }, [movies, sortBy]);

  // Set initial filter state based on screen width (only on mount)
  useEffect(() => {
    if (window.innerWidth <= 768) {
      setShowFilters(false);
    }
  }, []);
  
  const [watchedMovies, setWatchedMovies] = useState({});
  const [watchlist, setWatchlist] = useState({});
  // watchedList removed - now using watchedMovies with rating: 'watched' | 'dislike' | 'like' | 'superlike'
  const [ratingHistory, setRatingHistory] = useState([]);
  const [moviesDatabase, setMoviesDatabase] = useState({}); // New: Global movie metadata
  const [userInteractions, setUserInteractions] = useState([]); // New: User interactions

  const allGenres = [
    // Popular genres (shown by default)
    { id: 28, name: 'Action', popular: true }, 
    { id: 12, name: 'Adventure', popular: true }, 
    { id: 16, name: 'Animation', popular: true },
    { id: 35, name: 'Comedy', popular: true }, 
    { id: 80, name: 'Crime', popular: true }, 
    { id: 18, name: 'Drama', popular: true },
    { id: 10751, name: 'Family', popular: true }, 
    { id: 14, name: 'Fantasy', popular: true },
    { id: 27, name: 'Horror', popular: true }, 
    { id: 10749, name: 'Romance', popular: true }, 
    { id: 878, name: 'Sci-Fi', popular: true },
    { id: 53, name: 'Thriller', popular: true },
    
    // Additional genres (shown when "Show More" is clicked)
    { id: 99, name: 'Documentary', popular: false },
    { id: 36, name: 'History', popular: false }, 
    { id: 10402, name: 'Music', popular: false },
    { id: 9648, name: 'Mystery', popular: false }, 
    { id: 10770, name: 'TV Movie', popular: false }, 
    { id: 10752, name: 'War', popular: false },
    { id: 37, name: 'Western', popular: false }
  ];

  // TV-specific genres (TMDB has different genre IDs for TV)
  const tvGenres = [
    { id: 10759, name: 'Action & Adventure', popular: true },
    { id: 16, name: 'Animation', popular: true },
    { id: 35, name: 'Comedy', popular: true },
    { id: 80, name: 'Crime', popular: true },
    { id: 99, name: 'Documentary', popular: false },
    { id: 18, name: 'Drama', popular: true },
    { id: 10751, name: 'Family', popular: true },
    { id: 10762, name: 'Kids', popular: false },
    { id: 9648, name: 'Mystery', popular: true },
    { id: 10763, name: 'News', popular: false },
    { id: 10764, name: 'Reality', popular: false },
    { id: 10765, name: 'Sci-Fi & Fantasy', popular: true },
    { id: 10766, name: 'Soap', popular: false },
    { id: 10767, name: 'Talk', popular: false },
    { id: 10768, name: 'War & Politics', popular: false },
    { id: 37, name: 'Western', popular: false }
  ];

  // Use appropriate genre list based on media type
  const activeGenres = mediaType === 'tv' ? tvGenres : mediaType === 'movie' ? allGenres : [...allGenres, ...tvGenres.filter(tg => !allGenres.some(mg => mg.id === tg.id))];

  const countries = [
    { code: 'US', name: 'United States', flag: '🇺🇸' },
    { code: 'IN', name: 'India', flag: '🇮🇳' },
    { code: 'CN', name: 'China', flag: '🇨🇳' },
    { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
    { code: 'FR', name: 'France', flag: '🇫🇷' },
    { code: 'IT', name: 'Italy', flag: '🇮🇹' },
    { code: 'RU', name: 'Russia', flag: '🇷🇺' },
    { code: 'NP', name: 'Nepal', flag: '🇳🇵' },
    // Alphabetical after priority countries
    { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
    { code: 'AU', name: 'Australia', flag: '🇦🇺' },
    { code: 'AT', name: 'Austria', flag: '🇦🇹' },
    { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
    { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
    { code: 'CA', name: 'Canada', flag: '🇨🇦' },
    { code: 'CL', name: 'Chile', flag: '🇨🇱' },
    { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
    { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
    { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
    { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
    { code: 'FI', name: 'Finland', flag: '🇫🇮' },
    { code: 'DE', name: 'Germany', flag: '🇩🇪' },
    { code: 'GR', name: 'Greece', flag: '🇬🇷' },
    { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
    { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
    { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
    { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
    { code: 'IL', name: 'Israel', flag: '🇮🇱' },
    { code: 'JP', name: 'Japan', flag: '🇯🇵' },
    { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
    { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
    { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
    { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
    { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
    { code: 'NO', name: 'Norway', flag: '🇳🇴' },
    { code: 'PK', name: 'Pakistan', flag: '🇵🇰' },
    { code: 'PE', name: 'Peru', flag: '🇵🇪' },
    { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
    { code: 'PL', name: 'Poland', flag: '🇵🇱' },
    { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
    { code: 'RO', name: 'Romania', flag: '🇷🇴' },
    { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
    { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
    { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
    { code: 'ES', name: 'Spain', flag: '🇪🇸' },
    { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
    { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
    { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
    { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
    { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
    { code: 'AE', name: 'UAE', flag: '🇦🇪' },
    { code: 'VN', name: 'Vietnam', flag: '🇻🇳' }
  ];

  const getCountryFlag = (code) => countries.find(c => c.code === code)?.flag || '🌍';

  const genres = showAllGenres ? allGenres : allGenres.filter(g => g.popular);

  // Dynamic genre row calculation for CSS Grid
  useEffect(() => {
    const calculateGenresPerTwoRows = () => {
      const genreContainer = document.querySelector('.genre-list');
      if (!genreContainer) return;

      const containerWidth = genreContainer.offsetWidth;
      const minColumnWidth = 120; // minmax(120px, 1fr) from CSS
      const gap = 8; // CSS gap value

      // Calculate how many columns fit
      const columnsPerRow = Math.floor((containerWidth + gap) / (minColumnWidth + gap));
      const totalGenresInTwoRows = columnsPerRow * 2;

      setGenresPerTwoRows(totalGenresInTwoRows);
      setShowMoreButton(allGenres.length > totalGenresInTwoRows);
    };

    // Only calculate on mount and resize
    const timer = setTimeout(calculateGenresPerTwoRows, 200);
    window.addEventListener('resize', calculateGenresPerTwoRows);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', calculateGenresPerTwoRows);
    };
  }, []);

  // Update genres display based on calculation
  const displayedGenres = showMoreButton && !showAllGenres 
    ? allGenres.slice(0, genresPerTwoRows)
    : allGenres;

  const getLanguageName = (code) => {
    const languages = {
      'en': 'English', 'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil',
      'gu': 'Gujarati', 'ml': 'Malayalam', 'mr': 'Marathi', 'kn': 'Kannada',
      'bn': 'Bengali', 'th': 'Thai', 'id': 'Indonesian', 'fr': 'French',
      'es': 'Spanish', 'de': 'German', 'it': 'Italian', 'ja': 'Japanese',
      'ko': 'Korean', 'zh': 'Chinese (Mandarin)', 'pt': 'Portuguese',
      'ru': 'Russian', 'ar': 'Arabic', 'tr': 'Turkish', 'sv': 'Swedish',
      'da': 'Danish', 'no': 'Norwegian', 'nl': 'Dutch', 'pl': 'Polish',
      'fi': 'Finnish', 'sr': 'Serbian', 'cs': 'Czech', 'hu': 'Hungarian',
      'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak',
      'sl': 'Slovenian', 'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian',
      'is': 'Icelandic', 'mt': 'Maltese', 'cy': 'Welsh', 'ga': 'Irish',
      'he': 'Hebrew', 'fa': 'Persian', 'ur': 'Urdu', 'vi': 'Vietnamese',
      'ms': 'Malay', 'tl': 'Filipino', 'sw': 'Swahili', 'am': 'Amharic'
    };
    return languages[code] || code?.toUpperCase() || 'Unknown';
  };

  useEffect(() => {
    searchMovies();
  }, []);

  // Reset filters when changing views (but not searchScope - toggles manage that)
  useEffect(() => {
    setSearchTerm('');
    setSelectedGenres([]);
    setSelectedLanguage('');
    setSelectedRating('');
    setMinRating(0);
    setYearRange({ min: 2000, max: currentYear });
    setSearchCategory('Content');
  }, [currentView]);

  // Update tab indicator position
  useEffect(() => {
    const updateTabIndicator = () => {
      const nav = document.querySelector('header nav');
      const indicator = nav?.querySelector('.tab-indicator');
      const activeButton = nav?.querySelector('button.active');
      
      if (indicator && activeButton) {
        const buttonRect = activeButton.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const left = buttonRect.left - navRect.left;
        const width = buttonRect.width;
        
        indicator.style.left = `${left}px`;
        indicator.style.width = `${width}px`;
      }
    };
    
    // Update indicator after view change
    setTimeout(updateTabIndicator, 50);
  }, [currentView]);

  // Authentication listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setAuthLoading(false);
      
      // Close auth modal when user signs in
      if (user && showAuth) {
        setShowAuth(false);
      }
      
      if (user) {
        // User is signed in, load their data from Firebase
        console.log('User signed in:', user.email);
        
        // Check if we need to migrate localStorage data
        const migrated = await migrateLocalStorageToFirebase(user.uid);
        if (migrated) {
          console.log('Local data migrated to Firebase');
        }
        
        // Load user data from Firebase
        const userData = await getUserData(user.uid);
        
        // Merge old watchedList into watchedMovies (one-time migration)
        let mergedWatchedMovies = { ...(userData.watchedMovies || {}) };
        const oldWatchedList = userData.watchedList || {};
        if (Object.keys(oldWatchedList).length > 0) {
          for (const [movieId, data] of Object.entries(oldWatchedList)) {
            if (!mergedWatchedMovies[movieId]) {
              mergedWatchedMovies[movieId] = { rating: 'watched', ratedAt: data.watchedAt || new Date().toISOString() };
            }
          }
          // Sync merged watchedMovies, then clear the old watchedList field entirely
          await syncUserData(user.uid, { watchedMovies: mergedWatchedMovies });
          // Use setDoc directly to clear watchedList — syncUserData intentionally blocks
          // empty maps, so we bypass it for this one-time legacy field removal
          await setDoc(doc(db, 'users', user.uid), { watchedList: {} }, { merge: true });
          console.log('Migrated watchedList into watchedMovies');
        }
        
        setWatchedMovies(mergedWatchedMovies);
        setWatchlist(userData.watchlist || {});
        setRatingHistory(userData.ratingHistory || []);
        setMoviesDatabase(userData.moviesDatabase || {});
        setUserInteractions(userData.userInteractions || []);
        // Stamp UID so a future different-account sign-in on this browser
        // triggers the cross-account guard in migrateLocalStorageToFirebase
        localStorage.setItem('lastSyncedUid', user.uid);
        setDataLoaded(true);
      } else {
        // User is signed out, use localStorage
        console.log('User signed out, using localStorage');
        try {
          // Merge old watchedList into watchedMovies for localStorage too
          let localWatchedMovies = JSON.parse(localStorage.getItem('watchedMovies') || '{}');
          const localWatchedList = JSON.parse(localStorage.getItem('watchedList') || '{}');
          if (Object.keys(localWatchedList).length > 0) {
            for (const [movieId, data] of Object.entries(localWatchedList)) {
              if (!localWatchedMovies[movieId]) {
                localWatchedMovies[movieId] = { rating: 'watched', ratedAt: data.watchedAt || new Date().toISOString() };
              }
            }
            localStorage.setItem('watchedMovies', JSON.stringify(localWatchedMovies));
            localStorage.removeItem('watchedList');
          }
          
          setWatchedMovies(localWatchedMovies);
          setWatchlist(JSON.parse(localStorage.getItem('watchlist') || '{}'));
          setRatingHistory(JSON.parse(localStorage.getItem('ratingHistory') || '[]'));
          setMoviesDatabase(JSON.parse(localStorage.getItem('moviesDatabase') || '{}'));
          setUserInteractions(JSON.parse(localStorage.getItem('userInteractions') || '[]'));
          setDataLoaded(true);
        } catch (error) {
          console.error('Error loading from localStorage:', error);
          setWatchedMovies({});
          setWatchlist({});
          setRatingHistory([]);
          setMoviesDatabase({});
          setUserInteractions([]);
          setDataLoaded(true);
        }
      }
    });

    return () => unsubscribe();
  }, [showAuth]);

  // Trigger search when genre/language context changes
  useEffect(() => {
    if (genreSearch || languageSearch) {
      searchMovies(1);
    }
  }, [genreSearch, languageSearch]);

  // Trigger search when filters change (but only if we're on home view and not in a scoped search)
  useEffect(() => {
    if (currentView === 'home' && !searchScope.ratedOnly && !searchScope.watchlistedOnly && !searchScope.watchedOnly) {
      // Only trigger if we have some search criteria or filters applied, and avoid infinite loops
      if (searchTerm || selectedGenres.length > 0 || selectedRating || minRating > 0 || selectedLanguage) {
        const timeoutId = setTimeout(() => {
          searchMovies(1);
        }, 300); // Debounce to prevent rapid calls
        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedGenres, selectedRating, minRating, selectedLanguage]); // Removed yearRange to prevent too many calls

  // Re-search when mediaType changes (skip initial mount)
  const [mediaTypeInitialized, setMediaTypeInitialized] = useState(false);
  useEffect(() => {
    if (!mediaTypeInitialized) {
      setMediaTypeInitialized(true);
      return;
    }
    if (currentView === 'home') {
      searchMovies(1);
    }
  }, [mediaType]);

  // Refresh recommendations when watchedMovies changes (after rating)
  useEffect(() => {
    console.log('watchedMovies changed. Current state:', {
      directorSearch,
      castSearch,
      searchCategory,
      searchTerm,
      moviesCount: movies.length
    });
    
    // Only auto-refresh for general browsing, not for director/cast searches
    if (currentView === 'home' && movies.length > 0 && !directorSearch && !castSearch) {
      console.log('Auto-refresh triggered - calling searchMovies()');
      // If less than 5 movies remaining, refresh to get more
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      const unratedMovies = movies.filter(movie => !ratedMovieIds.includes(movie.id));
      
      if (unratedMovies.length < 5) {
        searchMovies();
      }
    } else {
      console.log('Auto-refresh skipped:', {
        currentView,
        moviesLength: movies.length,
        directorSearch,
        castSearch
      });
    }
  }, [watchedMovies]);

  // Persist data changes - ONLY after real data has been loaded
  // Without this guard, React's initial empty state ({}) gets written to localStorage
  // on first render, which can then trigger the migration bug on sign-in.
  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem('watchedMovies', JSON.stringify(watchedMovies));
    } catch (error) {
      console.error('Error saving watched movies:', error);
    }
  }, [watchedMovies, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem('watchlist', JSON.stringify(watchlist));
    } catch (error) {
      console.error('Error saving watchlist:', error);
    }
  }, [watchlist, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem('moviesDatabase', JSON.stringify(moviesDatabase));
    } catch (error) {
      console.error('Error saving movies database:', error);
    }
  }, [moviesDatabase, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    try {
      localStorage.setItem('userInteractions', JSON.stringify(userInteractions));
    } catch (error) {
      console.error('Error saving user interactions:', error);
    }
  }, [userInteractions, dataLoaded]);

  const findBestPersonMatch = (searchTerm, persons) => {
    const term = searchTerm.toLowerCase().trim();
    
    // Exact match first
    let match = persons.find(person => person.name.toLowerCase() === term);
    if (match) return match;
    
    // Full name contains all words
    const words = term.split(' ').filter(w => w.length > 0);
    match = persons.find(person => {
      const name = person.name.toLowerCase();
      return words.every(word => name.includes(word));
    });
    if (match) return match;
    
    // Partial word matching (Chris Bale -> Christian Bale)
    match = persons.find(person => {
      const name = person.name.toLowerCase();
      return words.some(word => {
        // Check if any name part starts with the search word
        return name.split(' ').some(namePart => 
          namePart.startsWith(word) || word.startsWith(namePart.substring(0, 3))
        );
      });
    });
    if (match) return match;
    
    // Fallback to first result
    return persons[0];
  };

  const searchMoviesByDirector = async (directorName) => {
    try {
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(directorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        setMovies([]);
        return;
      }
      
      const director = findBestPersonMatch(directorName, personData.results);
      const directorId = director.id;
      
      // Fetch both movie and TV credits
      let allResults = [];
      
      if (mediaType !== 'tv') {
        const movieCredits = await fetch(`https://api.themoviedb.org/3/person/${directorId}/movie_credits?api_key=${TMDB_API_KEY}`).then(r => r.json());
        const movieResults = (movieCredits.crew?.filter(m => m.job === 'Director') || []).map(m => ({ ...m, media_type: 'movie' }));
        allResults = [...allResults, ...movieResults];
      }
      
      if (mediaType !== 'movie') {
        const tvCredits = await fetch(`https://api.themoviedb.org/3/person/${directorId}/tv_credits?api_key=${TMDB_API_KEY}`).then(r => r.json());
        const tvResults = (tvCredits.crew?.filter(s => s.job === 'Director' || s.department === 'Directing') || [])
          .map(s => ({ ...s, media_type: 'tv', title: s.name, release_date: s.first_air_date }));
        allResults = [...allResults, ...tvResults];
      }
      
      // Apply filters
      if (selectedGenres.length > 0) {
        allResults = allResults.filter(m => m.genre_ids?.some(id => selectedGenres.includes(id)));
      }
      if (yearRange.min || yearRange.max) {
        allResults = allResults.filter(m => {
          const year = m.release_date ? parseInt(m.release_date.split('-')[0]) : 0;
          return year >= yearRange.min && year <= yearRange.max;
        });
      }
      if (minRating > 0) {
        allResults = allResults.filter(m => m.vote_average >= minRating);
      }
      
      allResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      
      setMovies(allResults);
      setDirectorSearch(director.name);
      setCastSearch(null);
    } catch (error) {
      console.error('Error fetching director content:', error);
    }
  };

  const searchMoviesByCast = async (actorName) => {
    try {
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(actorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        setMovies([]);
        return;
      }
      
      const actor = findBestPersonMatch(actorName, personData.results);
      const actorId = actor.id;
      
      let allResults = [];
      
      if (mediaType !== 'tv') {
        const movieCredits = await fetch(`https://api.themoviedb.org/3/person/${actorId}/movie_credits?api_key=${TMDB_API_KEY}`).then(r => r.json());
        const movieResults = (movieCredits.cast || []).map(m => ({ ...m, media_type: 'movie' }));
        allResults = [...allResults, ...movieResults];
      }
      
      if (mediaType !== 'movie') {
        const tvCredits = await fetch(`https://api.themoviedb.org/3/person/${actorId}/tv_credits?api_key=${TMDB_API_KEY}`).then(r => r.json());
        const tvResults = (tvCredits.cast || []).map(s => ({ ...s, media_type: 'tv', title: s.name, release_date: s.first_air_date }));
        allResults = [...allResults, ...tvResults];
      }
      
      if (selectedGenres.length > 0) {
        allResults = allResults.filter(m => m.genre_ids?.some(id => selectedGenres.includes(id)));
      }
      if (yearRange.min || yearRange.max) {
        allResults = allResults.filter(m => {
          const year = m.release_date ? parseInt(m.release_date.split('-')[0]) : 0;
          return year >= yearRange.min && year <= yearRange.max;
        });
      }
      if (minRating > 0) {
        allResults = allResults.filter(m => m.vote_average >= minRating);
      }
      
      allResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      
      setMovies(allResults);
      setCastSearch(actor.name);
      setDirectorSearch(null);
    } catch (error) {
      console.error('Error fetching cast content:', error);
    }
  };

  const searchMoviesByGenre = async (genreName) => {
    const genre = activeGenres.find(g => g.name.toLowerCase() === genreName.toLowerCase()) 
      || allGenres.find(g => g.name.toLowerCase() === genreName.toLowerCase());
    if (genre) {
      setSelectedGenres([genre.id]);
      setYearRange({ min: 2000, max: currentYear });
      setGenreSearch(genreName);
    }
  };

  const searchMoviesByLanguage = async (languageCode) => {
    const dropdownLanguages = ['en', 'hi', 'te', 'ta', 'gu', 'ml', 'mr', 'kn', 'bn', 'ar', 'zh', 'da', 'nl', 'fi', 'fr', 'de', 'id', 'it', 'ja', 'ko', 'no', 'pl', 'pt', 'ru', 'sr', 'es', 'sv', 'th', 'tr'];
    
    if (dropdownLanguages.includes(languageCode)) {
      setLanguage(languageCode);
    } else {
      setLanguage('other');
    }
    
    setYearRange({ min: 2000, max: currentYear });
    setLanguageSearch(getLanguageName(languageCode));
  };

  const sortMovies = async (movies, sortOption) => {
    const sorted = [...movies];
    switch (sortOption) {
      case 'title-asc':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'title-desc':
        return sorted.sort((a, b) => b.title.localeCompare(a.title));
      case 'year-asc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.release_date || '1900-01-01');
          const dateB = new Date(b.release_date || '1900-01-01');
          return dateA - dateB;
        });
      case 'year-desc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.release_date || '1900-01-01');
          const dateB = new Date(b.release_date || '1900-01-01');
          return dateB - dateA;
        });
      case 'rating-desc':
        return sorted.sort((a, b) => b.vote_average - a.vote_average);
      case 'rotten-tomatoes':
        // Fetch OMDB data for all movies to get RT ratings
        const moviesWithRT = await Promise.all(
          sorted.map(async (movie) => {
            try {
              const tmdbResponse = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}`);
              const tmdbData = await tmdbResponse.json();
              if (tmdbData.imdb_id) {
                const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${tmdbData.imdb_id}`);
                const omdbData = await omdbResponse.json();
                const rtRating = omdbData.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value;
                return { ...movie, rtRating: rtRating ? parseInt(rtRating.replace('%', '')) : 0 };
              }
            } catch (error) {
              console.error('Error fetching RT data:', error);
            }
            return { ...movie, rtRating: 0 };
          })
        );
        return moviesWithRT.sort((a, b) => b.rtRating - a.rtRating);
      case 'runtime-desc':
      case 'runtime-asc':
        // Fetch runtime data for all movies
        const moviesWithRuntime = await Promise.all(
          sorted.map(async (movie) => {
            try {
              const response = await fetch(`https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}`);
              const data = await response.json();
              return { ...movie, runtime: data.runtime || 0 };
            } catch (error) {
              console.error('Error fetching runtime data:', error);
              return { ...movie, runtime: 0 };
            }
          })
        );
        return moviesWithRuntime.sort((a, b) => 
          sortOption === 'runtime-desc' ? b.runtime - a.runtime : a.runtime - b.runtime
        );
      default:
        return sorted; // popularity (default TMDB order)
    }
  };

  const clearPersonSearch = () => {
    setDirectorSearch(null);
    setCastSearch(null);
    setGenreSearch(null);
    setLanguageSearch(null);
    setSearchTerm('');
    setSearchCategory('Content');
    setSelectedGenres([]);
    setSelectedLanguage('');
    setSelectedRating('');
    setMinRating(0);
    setYearRange({ min: 2000, max: currentYear });
    setCurrentPage(1);
    
    // Fetch fresh default content (bypass stale state) — both movies and shows
    const defaultYearMin = currentYear - 15;
    Promise.all([
      fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&primary_release_date.gte=${defaultYearMin}-01-01&primary_release_date.lte=${currentYear}-12-31&page=1&sort_by=popularity.desc`).then(r => r.json()),
      fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&first_air_date.gte=${defaultYearMin}-01-01&first_air_date.lte=${currentYear}-12-31&page=1&sort_by=popularity.desc`).then(r => r.json())
    ]).then(([movieData, tvData]) => {
      const movies = (movieData.results || []).map(m => ({ ...m, media_type: 'movie' }));
      const shows = (tvData.results || []).map(s => ({ ...s, media_type: 'tv', title: s.name, release_date: s.first_air_date }));
      const combined = [...movies, ...shows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      setMovies(combined);
    }).catch(err => console.error('Error refreshing:', err));
  };

  // Navigate to home and trigger a search (used by Ratings/Watchlist card clicks)
  const navigateAndSearch = (type, value) => {
    setCurrentView('home');
    setSearchScope({ ratedOnly: false, watchlistedOnly: false, watchedOnly: false });
    if (type === 'director') {
      setSearchTerm(value);
      setSearchCategory('Director');
      searchMoviesByDirector(value);
    } else if (type === 'cast') {
      setSearchTerm(value);
      setSearchCategory('Cast');
      searchMoviesByCast(value);
    } else if (type === 'genre') {
      searchMoviesByGenre(value);
    } else if (type === 'language') {
      searchMoviesByLanguage(value);
    }
  };

  // Search in local content database using normalized approach
  const searchInLocalContentDb = (filterCondition) => {
    console.log('Searching local content DB with condition:', filterCondition);
    
    if (!user) return;
    
    // Get valid user interactions based on filter condition
    const validInteractions = userInteractions.filter(interaction => 
      interaction.userId === user.uid && 
      interaction.valid === 1 &&
      filterCondition(interaction)
    );
    
    console.log('Valid interactions found:', validInteractions.length);
    
    // Join with movies database to get full movie details
    const results = validInteractions
      .map(interaction => {
        const movieData = moviesDatabase[interaction.movieId];
        if (!movieData) {
          console.log('Movie data not found for ID:', interaction.movieId);
          return null;
        }
        
        // Convert to display format
        return {
          id: movieData.tmdbId || movieData.movieId,
          title: movieData.movieName,
          release_date: movieData.releaseDate,
          vote_average: movieData.tmdb_rating,
          original_language: movieData.languages?.[0] || 'en',
          genre_ids: [], // Can be mapped from genres if needed
          overview: '', // Not stored in our DB yet
          poster_path: '', // Not stored in our DB yet
          userInteraction: interaction,
          movieMetadata: movieData
        };
      })
      .filter(movie => movie && applyCurrentFilters(movie));
    
    console.log('Final filtered results:', results.length);
    setMovies(results);
  };
  
  // Apply current UI filters (search term, language, etc.)
  const applyCurrentFilters = (movie) => {
    // Text search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const movieData = movie.movieMetadata;
      
      if (searchCategory === 'Movie') {
        if (!movie.title.toLowerCase().includes(term)) return false;
      } else if (searchCategory === 'Director') {
        if (!movieData.directors.some(director => director.toLowerCase().includes(term))) return false;
      } else if (searchCategory === 'Cast') {
        if (!movieData.cast.some(actor => actor.toLowerCase().includes(term))) return false;
      }
    }
    
    // Language filtering
    if (selectedLanguage && selectedLanguage !== 'all') {
      const movieData = movie.movieMetadata;
      if (!movieData.languages.includes(selectedLanguage)) return false;
    }
    
    // Content rating filtering
    if (selectedRating) {
      const movieData = movie.movieMetadata;
      if (movieData.contentRating !== selectedRating) return false;
    }
    
    return true;
  };

  const performSearch = () => {
    const hasScopeFilters = searchScope.ratedOnly || searchScope.watchlistedOnly || searchScope.watchedOnly;
    
    if (hasScopeFilters) {
      return;
    }
    
    setCurrentView('home');
    setMovies([]);
    
    if (searchCategory === 'Director') {
      searchMoviesByDirector(searchTerm);
    } else if (searchCategory === 'Cast') {
      searchMoviesByCast(searchTerm);
    } else {
      // Content search — uses mediaType filter
      setGenreSearch(null);
      setLanguageSearch(null);
      searchMovies(1);
    }
  };

  // Trigger scoped search when scope changes (even without search button click)
  useEffect(() => {
    if (searchScope.ratedOnly || searchScope.watchlistedOnly || searchScope.watchedOnly) {
      performSearch();
    }
  }, [searchScope.ratedOnly, searchScope.watchlistedOnly, searchScope.watchedOnly]);

  const toggleGenre = (genreId) => {
    setSelectedGenres(prev => 
      prev.includes(genreId) 
        ? prev.filter(id => id !== genreId)
        : [...prev, genreId]
    );
  };

  const fetchNextPage = async () => {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    searchMovies(nextPage);
  };

  const fetchPreviousPage = async () => {
    if (currentPage <= 1) return;
    const prevPage = currentPage - 1;
    setCurrentPage(prevPage);
    searchMovies(prevPage);
  };

  const searchInRatedMovies = async () => {
    // Allow filtering even without search term if filters are applied
    const hasFilters = minRating > 0 || selectedGenres.length > 0 || selectedLanguage || 
                      yearRange.min !== (new Date().getFullYear() - 15) || yearRange.max !== new Date().getFullYear();
    
    if (!searchTerm.trim() && !hasFilters) return;
    
    const ratedMovieIds = Object.keys(watchedMovies);
    const filteredMovies = [];
    
    for (const movieId of ratedMovieIds) {
      try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
        const movie = await response.json();
        
        // Search in title, director, cast based on search category (only if search term exists)
        let matches = true; // Default to true if no search term
        
        if (searchTerm.trim()) {
          matches = false;
          if (searchCategory === 'Movie' && movie.title.toLowerCase().includes(searchTerm.toLowerCase())) {
            matches = true;
          } else if (searchCategory === 'Director') {
            const creditsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
            const credits = await creditsResponse.json();
            const director = credits.crew?.find(person => person.job === 'Director');
            if (director && director.name.toLowerCase().includes(searchTerm.toLowerCase())) {
              matches = true;
            }
          } else if (searchCategory === 'Cast') {
            const creditsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
            const credits = await creditsResponse.json();
            const castMatch = credits.cast?.some(actor => 
              actor.name.toLowerCase().includes(searchTerm.toLowerCase())
            );
            if (castMatch) {
              matches = true;
            }
          }
        }
        
        if (matches) {
          // Apply additional filters
          let passesFilters = true;
          
          // Apply minimum rating filter
          if (minRating > 0 && movie.vote_average < minRating) {
            passesFilters = false;
          }
          
          // Apply genre filter
          if (selectedGenres.length > 0 && passesFilters) {
            const hasMatchingGenre = movie.genre_ids && movie.genre_ids.some(id => selectedGenres.includes(id));
            if (!hasMatchingGenre) {
              passesFilters = false;
            }
          }
          
          // Apply year range filter
          if (passesFilters && movie.release_date) {
            const movieYear = new Date(movie.release_date).getFullYear();
            if (movieYear < yearRange.min || movieYear > yearRange.max) {
              passesFilters = false;
            }
          }
          
          // Apply language filter
          if (passesFilters && selectedLanguage && selectedLanguage !== 'other') {
            if (movie.original_language !== selectedLanguage) {
              passesFilters = false;
            }
          }
          
          if (passesFilters) {
            filteredMovies.push(movie);
          }
        }
      } catch (error) {
        console.error('Error searching rated movies:', error);
      }
    }
    
    setMovies(filteredMovies);
  };

  const searchInWatchlistMovies = async () => {
    if (!searchTerm.trim()) return;
    
    let movieIds = [];
    
    if (searchScope.watchlistedOnly) {
      movieIds = [...movieIds, ...Object.keys(watchlist)];
    }
    if (searchScope.watchedOnly) {
      movieIds = [...movieIds, ...Object.keys(watchedMovies)];
    }
    
    // Remove duplicates
    movieIds = [...new Set(movieIds)];
    
    const filteredMovies = [];
    
    for (const movieId of movieIds) {
      try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
        const movie = await response.json();
        
        // Search in title, director, cast based on search category
        let matches = false;
        if (searchCategory === 'Movie' && movie.title.toLowerCase().includes(searchTerm.toLowerCase())) {
          matches = true;
        } else if (searchCategory === 'Director') {
          const creditsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
          const credits = await creditsResponse.json();
          const director = credits.crew?.find(person => person.job === 'Director');
          if (director && director.name.toLowerCase().includes(searchTerm.toLowerCase())) {
            matches = true;
          }
        } else if (searchCategory === 'Cast') {
          const creditsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
          const credits = await creditsResponse.json();
          const castMatch = credits.cast?.some(actor => 
            actor.name.toLowerCase().includes(searchTerm.toLowerCase())
          );
          if (castMatch) {
            matches = true;
          }
        }
        
        if (matches) {
          filteredMovies.push(movie);
        }
      } catch (error) {
        console.error('Error searching watchlist movies:', error);
      }
    }
    
    setMovies(filteredMovies);
  };

  const searchMovies = async (page = 1, accumulatedResults = []) => {
    try {
      if (page === 1) setMovies([]);
      
      const genreQuery = selectedGenres.length ? `&with_genres=${selectedGenres.join(',')}` : '';
      const minRatingQuery = minRating > 0 ? `&vote_average.gte=${minRating}` : '';
      
      let languageQuery = '';
      if (languageSearch && selectedLanguage === 'other') {
        const languageCode = Object.keys({
          'en': 'English', 'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil',
          'gu': 'Gujarati', 'ml': 'Malayalam', 'mr': 'Marathi', 'kn': 'Kannada',
          'bn': 'Bengali', 'th': 'Thai', 'id': 'Indonesian', 'fr': 'French',
          'es': 'Spanish', 'de': 'German', 'it': 'Italian', 'ja': 'Japanese',
          'ko': 'Korean', 'zh': 'Chinese (Mandarin)', 'pt': 'Portuguese',
          'ru': 'Russian', 'ar': 'Arabic', 'tr': 'Turkish', 'sv': 'Swedish',
          'da': 'Danish', 'no': 'Norwegian', 'nl': 'Dutch', 'pl': 'Polish',
          'fi': 'Finnish', 'sr': 'Serbian', 'cs': 'Czech', 'hu': 'Hungarian'
        }).find(code => getLanguageName(code) === languageSearch);
        if (languageCode) languageQuery = `&with_original_language=${languageCode}`;
      } else if (selectedLanguage && selectedLanguage !== 'other') {
        languageQuery = `&with_original_language=${selectedLanguage}`;
      }
      
      const searchQuery = searchTerm ? `&query=${encodeURIComponent(searchTerm)}` : '';
      const pageQuery = `&page=${page}`;

      // Determine which types to fetch based on mediaType
      const fetchTypes = mediaType === 'all' ? ['movie', 'tv'] : [mediaType];
      
      let allTypeResults = [];
      
      for (const type of fetchTypes) {
        const isTV = type === 'tv';
        const dateField = isTV ? 'first_air_date' : 'primary_release_date';
        const yearQuery = `&${dateField}.gte=${yearRange.min}-01-01&${dateField}.lte=${yearRange.max}-12-31`;
        const ratingQuery = (!isTV && selectedRating) ? `&certification_country=US&certification=${selectedRating}` : '';
        
        // Filter genre IDs to only those valid for this type
        const movieGenreIds = allGenres.map(g => g.id);
        const tvGenreIds = tvGenres.map(g => g.id);
        const validGenreIds = selectedGenres.filter(id => isTV ? tvGenreIds.includes(id) : movieGenreIds.includes(id));
        const typeGenreQuery = validGenreIds.length ? `&with_genres=${validGenreIds.join(',')}` : '';
        
        let endpoint;
        if (searchTerm) {
          endpoint = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}${searchQuery}${languageQuery}${pageQuery}`;
        } else {
          endpoint = `https://api.themoviedb.org/3/discover/${type}?api_key=${TMDB_API_KEY}${typeGenreQuery}${yearQuery}${ratingQuery}${minRatingQuery}${languageQuery}${pageQuery}&sort_by=popularity.desc`;
        }
        
        const response = await fetch(endpoint);
        const data = await response.json();
        let results = (data.results || []).map(item => ({
          ...item,
          media_type: type,
          title: item.title || item.name,
          release_date: item.release_date || item.first_air_date
        }));
        
        // Apply client-side filters for search results
        if (searchTerm) {
          if (selectedRating && !isTV) {
            if (selectedRating === 'G' || selectedRating === 'PG') results = results.filter(m => !m.adult);
            else if (selectedRating === 'R' || selectedRating === 'NC-17') results = results.filter(m => m.adult);
          }
          if (minRating > 0) results = results.filter(m => m.vote_average >= minRating);
          if (selectedGenres.length > 0) results = results.filter(m => m.genre_ids?.some(id => selectedGenres.includes(id)));
          results = results.filter(m => {
            if (!m.release_date) return false;
            const year = parseInt(m.release_date.split('-')[0]);
            return year >= yearRange.min && year <= yearRange.max;
          });
          // Language filter for search
          if (languageSearch && selectedLanguage === 'other') {
            const lc = Object.keys({'en':'English','hi':'Hindi','te':'Telugu','ta':'Tamil','gu':'Gujarati','ml':'Malayalam','mr':'Marathi','kn':'Kannada','bn':'Bengali'}).find(c => getLanguageName(c) === languageSearch);
            if (lc) results = results.filter(m => m.original_language === lc);
          } else if (selectedLanguage && selectedLanguage !== 'other') {
            results = results.filter(m => m.original_language === selectedLanguage);
          }
        }
        
        // Filter for "Other Languages"
        if (selectedLanguage === 'other' && !languageSearch) {
          const commonLangs = ['en','hi','te','ta','gu','ml','mr','kn','bn','th','id','fr','es','de','it','ja','ko','zh','pt','ru','ar','tr','sv','da','no','nl','pl'];
          results = results.filter(m => !commonLangs.includes(m.original_language));
        }
        
        allTypeResults = [...allTypeResults, ...results];
      }
      
      // Filter out watched/rated/watchlisted when browsing (not searching)
      if (!searchTerm) {
        const watchedIds = Object.keys(watchedMovies).map(id => parseInt(id));
        const watchlistedIds = Object.keys(watchlist).map(id => parseInt(id));
        const excludeIds = new Set([...watchedIds, ...watchlistedIds]);
        allTypeResults = allTypeResults.filter(m => !excludeIds.has(m.id));
      }
      
      // Sort combined results by popularity
      allTypeResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      
      const allResults = [...accumulatedResults, ...allTypeResults];
      const apiReturnedResults = allTypeResults.length > 0;
      
      if (searchTerm && page < 3 && apiReturnedResults) return searchMovies(page + 1, allResults);
      if (allResults.length === 0 && apiReturnedResults && page < 5) return searchMovies(page + 1, allResults);
      if (allResults.length < 10 && allTypeResults.length > 0 && page < 10) return searchMovies(page + 1, allResults);
      
      setMovies([...allResults]);
      setCurrentPage(1);
    } catch (error) {
      console.error('Error fetching content:', error);
    }
  };

  const getMovieDetails = async (movieId, itemMediaType) => {
    try {
      const type = itemMediaType || 'movie';
      const tmdbResponse = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits`);
      const tmdbData = await tmdbResponse.json();
      
      // Normalize TV fields to match movie structure
      if (type === 'tv') {
        tmdbData.title = tmdbData.name;
        tmdbData.release_date = tmdbData.first_air_date;
        tmdbData.runtime = tmdbData.episode_run_time?.[0] || null;
        tmdbData.media_type = 'tv';
      } else {
        tmdbData.media_type = 'movie';
      }
      
      // Fetch OMDB data (movies only — OMDB doesn't reliably support TV by TMDB ID)
      let omdbData = {};
      if (type === 'movie' && tmdbData.imdb_id) {
        try {
          const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${tmdbData.imdb_id}`);
          omdbData = await omdbResponse.json();
        } catch (e) { /* OMDB optional */ }
      } else if (type === 'tv' && tmdbData.external_ids?.imdb_id) {
        try {
          const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${tmdbData.external_ids.imdb_id}`);
          omdbData = await omdbResponse.json();
        } catch (e) { /* OMDB optional */ }
      }
      
      // Fetch watch providers
      let watchProviders = {};
      try {
        const wpResponse = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}/watch/providers?api_key=${TMDB_API_KEY}`);
        const wpData = await wpResponse.json();
        watchProviders = wpData.results || {};
      } catch (e) { /* watch providers optional */ }
      
      return { ...tmdbData, omdbData, watchProviders };
    } catch (error) {
      console.error('Error fetching details:', error);
      return null;
    }
  };

  // Store movie metadata in global database
  const storeMovieMetadata = async (movieId, movieData) => {
    const movieRecord = {
      movieId: movieId,
      title: movieData.title,
      movieName: movieData.title,
      tmdbId: movieData.tmdbId || null,
      omdbId: movieData.omdbId || null,
      cast: movieData.cast || [],
      directors: movieData.directors || [],
      genres: movieData.genres || [],
      genre_ids: movieData.genre_ids || [],
      releaseDate: movieData.releaseDate,
      year: movieData.year || null,
      contentRating: movieData.contentRating,
      language: movieData.language || null,
      languages: movieData.languages || [],
      tmdb_rating: movieData.tmdbRating,
      imdb_rating: movieData.imdbRating,
      rotten_tomatoes: movieData.rottenTomatoes || null,
      movieIdSource: movieData.source || 'tmdb',
      mediaType: movieData.mediaType || 'movie'
    };
    
    setMoviesDatabase(prev => ({...prev, [movieId]: movieRecord}));
    return movieRecord;
  };

  // Backfill missing movie metadata for all rated/watchlisted/watched movies
  const [backfillStatus, setBackfillStatus] = useState({ running: false, progress: '', done: 0, total: 0 });
  
  const backfillMovieMetadata = async () => {
    if (!user) {
      alert('Please sign in first');
      return;
    }
    
    // Security check - only allow for specific user (uses Firebase auth email, not frontend)
    const ADMIN_EMAIL = 'keshav.kritesh@gmail.com';
    if (user.email !== ADMIN_EMAIL) {
      alert('Sync function is disabled for this account');
      return;
    }
    
    // DISABLED: Uncomment the line below to enable backfill
    alert('Backfill disabled. Uncomment backfillMovieMetadataExecute() call to enable.');
    return;
    // await backfillMovieMetadataExecute();
  };
  
  const backfillMovieMetadataExecute = async () => {
    
    // Collect all unique movie IDs
    const allMovieIds = new Set([
      ...Object.keys(watchedMovies),
      ...Object.keys(watchlist)
    ]);
    
    // Filter to only movies missing metadata or with incomplete data
    const movieIdsToBackfill = [...allMovieIds].filter(id => {
      const existing = moviesDatabase[id];
      // Backfill if missing entirely OR missing key fields
      return !existing || !existing.title || !existing.genre_ids || !existing.year || !existing.language;
    });
    
    console.log('Total movies:', allMovieIds.size);
    console.log('Movies to backfill:', movieIdsToBackfill.length);
    console.log('Sample existing:', moviesDatabase[Object.keys(moviesDatabase)[0]]);
    
    if (movieIdsToBackfill.length === 0) {
      alert('All movies already have complete metadata!');
      return;
    }
    
    const total = movieIdsToBackfill.length;
    setBackfillStatus({ running: true, progress: `Starting backfill for ${total} movies...`, done: 0, total });
    
    let done = 0;
    const updatedDatabase = { ...moviesDatabase };
    
    for (const movieId of movieIdsToBackfill) {
      try {
        const movieResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
        const movieData = await movieResponse.json();
        
        const creditsResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`);
        const creditsData = await creditsResponse.json();
        
        // OMDB is optional - skip if it fails
        let omdbData = {};
        try {
          const omdbResponse = await fetch(`https://www.omdbapi.com/?i=${movieData.imdb_id}&apikey=${OMDB_API_KEY}`);
          omdbData = await omdbResponse.json();
        } catch (e) {
          console.log('OMDB skipped for', movieId);
        }
        
        updatedDatabase[movieId] = {
          movieId: movieId,
          title: movieData.title,
          movieName: movieData.title,
          tmdbId: parseInt(movieId),
          omdbId: movieData.imdb_id,
          cast: creditsData.cast?.slice(0, 10).map(actor => actor.name) || [],
          directors: creditsData.crew?.filter(p => p.job === 'Director').map(d => d.name) || [],
          genres: movieData.genres?.map(g => g.name) || [],
          genre_ids: movieData.genres?.map(g => g.id) || [],
          releaseDate: movieData.release_date,
          year: movieData.release_date ? new Date(movieData.release_date).getFullYear() : null,
          contentRating: omdbData?.Rated && omdbData.Rated !== 'N/A' ? omdbData.Rated : null,
          language: movieData.original_language,
          languages: [movieData.original_language],
          tmdb_rating: movieData.vote_average,
          imdb_rating: omdbData?.imdbRating && omdbData.imdbRating !== 'N/A' ? parseFloat(omdbData.imdbRating) : null,
          rotten_tomatoes: null,
          movieIdSource: 'tmdb'
        };
        
        done++;
        setBackfillStatus({ running: true, progress: `Processed ${done}/${total} movies...`, done, total });
        
        if (done % 10 === 0 || done === total) {
          setMoviesDatabase({ ...updatedDatabase });
        }
      } catch (error) {
        console.error(`Error backfilling movie ${movieId}:`, error);
        done++;
        setBackfillStatus({ running: true, progress: `Processed ${done}/${total} movies...`, done, total });
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    setMoviesDatabase(updatedDatabase);
    
    // Sync to Firebase
    if (user) {
      try {
        console.log('Syncing moviesDatabase to Firebase, size:', Object.keys(updatedDatabase).length);
        await syncUserData(user.uid, {
          watchedMovies,
          watchlist,
          ratingHistory,
          moviesDatabase: updatedDatabase,
          userInteractions
        });
        console.log('Firebase sync successful!');
      } catch (error) {
        console.error('Firebase sync FAILED:', error);
        alert('Firebase sync failed: ' + error.message);
      }
    }
    
    setBackfillStatus({ running: false, progress: `Done! Updated ${done} movies.`, done, total });
    alert(`Backfill complete! Updated metadata for ${done} movies.`);
  };

  // Backup/Restore handlers
  const handleExportBackup = async () => {
    if (!user) {
      alert('Please sign in to export your data');
      return;
    }
    const success = await exportUserDataBackup(user.uid);
    if (success) {
      alert('Backup downloaded successfully!');
    } else {
      alert('Failed to export backup. Check console for details.');
    }
  };

  const handleImportBackup = () => {
    if (!user) {
      alert('Please sign in to import data');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const restoredData = await importUserDataBackup(user.uid, text);
        // Reload state from restored data
        if (restoredData.watchedMovies) setWatchedMovies(restoredData.watchedMovies);
        if (restoredData.watchlist) setWatchlist(restoredData.watchlist);
        if (restoredData.ratingHistory) setRatingHistory(restoredData.ratingHistory);
        if (restoredData.moviesDatabase) setMoviesDatabase(restoredData.moviesDatabase);
        if (restoredData.userInteractions) setUserInteractions(restoredData.userInteractions);
        alert(`Backup restored! ${Object.keys(restoredData.watchedMovies || {}).length} ratings, ${Object.keys(restoredData.watchlist || {}).length} watchlist items.`);
      } catch (err) {
        alert('Failed to restore: ' + err.message);
      }
    };
    input.click();
  };

  // Store user interaction
  const storeUserInteraction = async (movieId, action, userRating = null) => {
    if (!user) return;
    
    // Mark previous interactions as invalid
    const updatedInteractions = userInteractions.map(interaction => 
      interaction.movieId === movieId && interaction.userId === user.uid
        ? {...interaction, valid: 0}
        : interaction
    );
    
    // Add new interaction
    const newInteraction = {
      userId: user.uid,
      movieId: movieId,
      action: action,
      isWatched: action === 'watched' ? 1 : 0,
      isWatchlisted: action === 'watchlisted' ? 1 : 0,
      userWatchedRating: userRating,
      valid: 1,
      timestamp: new Date().toISOString()
    };
    
    updatedInteractions.push(newInteraction);
    setUserInteractions(updatedInteractions);
    
    console.log('Stored user interaction:', newInteraction);
  };

  // Combined function to store both movie data and user interaction
  // Works for both logged-in (Firebase) and logged-out (localStorage) users
  const storeMovieInteraction = async (movieId, action, userRating = null, watchlisted = false) => {
    try {
      // Determine media type from current movies array
      const currentMovie = movies.find(m => m.id === movieId);
      const type = currentMovie?.media_type || 'movie';
      
      const movieResponse = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}`);
      const movieData = await movieResponse.json();
      
      const creditsResponse = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}/credits?api_key=${TMDB_API_KEY}`);
      const creditsData = await creditsResponse.json();
      
      // Get OMDB data (optional)
      let omdbData = {};
      const imdbId = movieData.imdb_id || movieData.external_ids?.imdb_id;
      if (imdbId) {
        try {
          const omdbResponse = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_API_KEY}`);
          omdbData = await omdbResponse.json();
        } catch (e) { /* optional */ }
      }
      
      const title = movieData.title || movieData.name;
      const releaseDate = movieData.release_date || movieData.first_air_date;
      
      await storeMovieMetadata(movieId, {
        title,
        tmdbId: movieId,
        omdbId: imdbId,
        cast: creditsData.cast?.slice(0, 10).map(actor => actor.name) || [],
        cast_ids: creditsData.cast?.slice(0, 10).map(actor => actor.id) || [],
        directors: creditsData.crew?.filter(person => person.job === 'Director').map(director => director.name) || [],
        director_ids: creditsData.crew?.filter(person => person.job === 'Director').map(director => director.id) || [],
        genres: movieData.genres?.map(genre => genre.name) || [],
        genre_ids: movieData.genres?.map(genre => genre.id) || [],
        releaseDate,
        year: releaseDate ? new Date(releaseDate).getFullYear() : null,
        contentRating: omdbData.Rated && omdbData.Rated !== 'N/A' ? omdbData.Rated : null,
        language: movieData.original_language,
        languages: [movieData.original_language],
        tmdbRating: movieData.vote_average,
        imdbRating: omdbData.imdbRating && omdbData.imdbRating !== 'N/A' ? parseFloat(omdbData.imdbRating) : null,
        rottenTomatoes: null,
        source: 'tmdb',
        mediaType: type
      });
      
      // Store user interaction (only if logged in)
      if (user) {
        await storeUserInteraction(movieId, action, userRating);
      }
      
    } catch (error) {
      console.error('Error storing movie interaction:', error);
    }
  };

  const markAsWatched = async (movieId, rating) => {
    const currentRating = watchedMovies[movieId];
    const timestamp = new Date().toISOString();
    
    const movie = movies.find(m => m.id === movieId);
    const movieTitle = movie ? movie.title : `Movie ${movieId}`;
    
    let updated = { ...watchedMovies };
    let updatedWatchlist = { ...watchlist };
    let historyEntry = '';
    
    const currentRatingValue = typeof currentRating === 'object' ? currentRating.rating : currentRating;
    
    if (currentRating && currentRatingValue === rating) {
      // Remove rating if clicking same rating - set to 'watched' instead of deleting
      updated[movieId] = { rating: 'watched', ratedAt: currentRating.ratedAt || timestamp };
      historyEntry = `Removed ${rating} from "${movieTitle}" on ${new Date().toLocaleString()}`;
    } else {
      // Add/change rating
      updated[movieId] = { rating, ratedAt: timestamp };
      historyEntry = `${rating === 'superlike' ? 'Superliked' : rating === 'like' ? 'Liked' : 'Disliked'} "${movieTitle}" on ${new Date().toLocaleString()}`;
      
      const userRatingValue = rating === 'dislike' ? -1 : rating === 'like' ? 2 : rating === 'superlike' ? 3 : 1;
      // Fire-and-forget: don't block the UI on metadata store
      storeMovieInteraction(movieId, 'rated', userRatingValue, false).catch(console.error);
    }
    
    // Optimistic: update local state IMMEDIATELY so UI responds instantly
    setWatchedMovies(updated);
    
    const updatedHistory = [historyEntry, ...ratingHistory];
    setRatingHistory(updatedHistory);
    
    // Firebase sync — fire-and-forget (don't block UI)
    if (user) {
      syncUserData(user.uid, {
        watchedMovies: updated,
        watchlist: updatedWatchlist,
        ratingHistory: updatedHistory,
        moviesDatabase,
        userInteractions
      }).catch((error) => console.error('Failed to sync rating data:', error));
    } else {
      localStorage.setItem('watchedMovies', JSON.stringify(updated));
      localStorage.setItem('watchlist', JSON.stringify(updatedWatchlist));
      localStorage.setItem('ratingHistory', JSON.stringify(updatedHistory));
      localStorage.setItem('moviesDatabase', JSON.stringify(moviesDatabase));
      localStorage.setItem('userInteractions', JSON.stringify(userInteractions));
    }
  };

  // Toggle watched status - now uses watchedMovies with rating: 'watched'
  const toggleWatched = async (movieId) => {
    const movie = movies.find(m => m.id === movieId);
    const movieTitle = movie ? movie.title : `Movie ${movieId}`;
    const timestamp = new Date().toISOString();
    
    const updated = { ...watchedMovies };
    let historyEntry = '';
    const isCurrentlyWatched = watchedMovies[movieId];
    
    if (isCurrentlyWatched) {
      // Only remove if it was just 'watched' (no thumbs rating)
      if (watchedMovies[movieId].rating === 'watched') {
        delete updated[movieId];
        historyEntry = `Unmarked "${movieTitle}" as watched on ${new Date().toLocaleString()}`;
      } else {
        // Has a rating, don't remove - just toggle visual state
        return;
      }
    } else {
      updated[movieId] = { rating: 'watched', ratedAt: timestamp };
      historyEntry = `Marked "${movieTitle}" as watched on ${new Date().toLocaleString()}`;
      await storeMovieInteraction(movieId, 'watched', null, false);
    }
    
    setWatchedMovies(updated);
    
    const updatedHistory = [historyEntry, ...ratingHistory];
    setRatingHistory(updatedHistory);
    
    if (user) {
      try {
        if (isCurrentlyWatched && watchedMovies[movieId].rating === 'watched') {
          await removeFromCollection(user.uid, 'watchedMovies', String(movieId));
        }
        await syncUserData(user.uid, {
          watchedMovies: updated,
          watchlist,
          ratingHistory: updatedHistory,
          moviesDatabase,
          userInteractions
        });
      } catch (error) {
        console.error('Failed to sync watched data:', error);
      }
    } else {
      localStorage.setItem('watchedMovies', JSON.stringify(updated));
      localStorage.setItem('ratingHistory', JSON.stringify(updatedHistory));
    }
  };

  const toggleWatchlist = async (movieId) => {
    const updated = { ...watchlist };
    const isAdding = !watchlist[movieId];
    
    if (watchlist[movieId]) {
      delete updated[movieId];
    } else {
      updated[movieId] = { addedAt: new Date().toISOString() };
    }
    setWatchlist(updated);
    
    // Fire-and-forget: store interaction + sync (state already updated above)
    if (!watchlist[movieId]) {
      storeMovieInteraction(movieId, 'watchlisted', null, false).catch(console.error);
    }
    
    // Sync with Firebase if user is logged in (fire-and-forget for instant UI)
    if (user) {
      (async () => {
        try {
          if (!isAdding) {
            await removeFromCollection(user.uid, 'watchlist', String(movieId));
          }
          await syncUserData(user.uid, {
            watchedMovies,
            watchlist: updated,
            ratingHistory,
            moviesDatabase,
            userInteractions
          });
        } catch (error) {
          console.error('Failed to sync watchlist data:', error);
        }
      })();
    } else {
      localStorage.setItem('watchlist', JSON.stringify(updated));
      localStorage.setItem('moviesDatabase', JSON.stringify(moviesDatabase));
      localStorage.setItem('userInteractions', JSON.stringify(userInteractions));
    }
  };

  const handleGenreChange = (genreId) => {
    setSelectedGenres(prev => 
      prev.includes(genreId) 
        ? prev.filter(id => id !== genreId)
        : [...prev, genreId]
    );
  };

  return (
    <div className="App">
      {/* Deep-link shared item modal */}
      {sharedItem && (
        <div className="shared-modal-overlay" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); }}>
          <div className="shared-modal" onClick={(e) => e.stopPropagation()}>
            <button className="shared-modal-close" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); }}>✕</button>
            <div className="shared-modal-content">
              {sharedItem.backdrop_path && (
                <div className="shared-modal-backdrop">
                  <img src={`https://image.tmdb.org/t/p/w780${sharedItem.backdrop_path}`} alt="" />
                  <div className="shared-modal-backdrop-fade" />
                </div>
              )}
              <div className="shared-modal-body">
                <div className="shared-modal-poster">
                  {/* Rating badges above poster */}
                  {(() => {
                    const badges = [];
                    if (sharedItem.vote_average > 0) badges.push(
                      <span key="tmdb" className="rating-badge tmdb-badge" title="TMDB">
                        <img src="https://www.themoviedb.org/assets/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg" alt="TMDB" width="14" height="14" style={{borderRadius:2}} />
                        {sharedItem.vote_average.toFixed(1)}
                      </span>
                    );
                    if (sharedItem.omdbData?.imdbRating && sharedItem.omdbData.imdbRating !== 'N/A') badges.push(
                      <span key="imdb" className="rating-badge imdb-badge" title="IMDb">
                        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABpUlEQVQoz41SPWsUYRiceXdvN3t38VAs/AhcCg9BiI1FRJTY2ATyCxQ7GxsRf4KdpUUwhSgEC1OmE5PCThTxm0QRFESFQEyOrN7u+z7P+1hcYZkdpphmmIEZbq4fLbopDPuDGJWSZnnancwt7u+gowakEhC8WYME0iQgVYEGNDNABU4EMdKRZkzIqEhIgAmZkDCa0ZEiGDO1yI+bfnVt79L5zur63vUrB+892j13pnj1vhK1udl21uLLt9Wta4dGlUmAM8WPX7K4vPPlm3+wMnzy7M/9x7sbn/3i8k5Zxss3fn745O8sbd+8vfVuo6bRicAiAMAI4O7D38UEx6WnpzIAwdvMyfzFm9Hz1yOLcBpMFQAk2Pxcd2tbT53IowJAFACICkcWOR0oAakIJBiA2tv08RaAQT+vawPw9bsHECPKvxGA96ZiydWFXlBmLc4MJtq56x/Lzp4uOm135HCLxPyFyUE/Sxw7hVu4eCBLwKdLU71enjhoBAnH/wKAATEicQChiuGwTjXA19Z0uPHSEtAQKkhVqMKG31BhWpZBBE06kayq8A/tluDm21lpHwAAAABJRU5ErkJggg==" alt="IMDb" width="14" height="14" style={{borderRadius:2}} />
                        {sharedItem.omdbData.imdbRating}
                      </span>
                    );
                    const rt = sharedItem.omdbData?.Ratings?.find(r => r.Source === 'Rotten Tomatoes');
                    if (rt) {
                      const pct = parseInt(rt.Value);
                      badges.push(
                        <span key="rt" className={`rating-badge rt-badge ${pct >= 60 ? 'rt-fresh' : 'rt-rotten'}`} title="Rotten Tomatoes">
                          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABoUlEQVQ4jWNgQAfdiiWM/Tq3wOxaIXOGDvlsDDU4QaukO0OPSh3TBN0fjH1ae5im6f9n6tf9wsDwn7Bexn7t1UxTgRqm6P1nmqj7n2mS3n8GIM3Qr/MBSD9nmKR7g2Ga1mzcJkyU8WCYqHOBYTJUIxCb9ur8Ypii/8W3S/vH6iLFn+djpf4/9RC4hqm5Wyk9pUsbZNu3bbny35YXKX5jmGHw/06I2Of/0oz//6sw//+nxfr/jy7b/39GHP9/GnH8RPHVb13W6/9VWf7/V2b+/1+R6f/cUqW3JxOlv/7XYAEpxsB/jDn+/zJiewbW/EuFKfG/CSeKgn/aENuwaYbh/yYc/3+rs+Qx/NJj3fXXGLdCXBisR591D8MvA/Ybv8kwAKQHqPcm0AC2O2QboM9+mwHojINke0GPdT/DLy3mZlCAkGoAWI8aSwEkJozY35PiDbDthmxPEelAmsHhFzR+idJsxPEDIzF+lWQw+mnE/hrkNEhCQQowqOFgZwMDHW+m+qnBUgdUdPaXIfvLH0Yc/34acvwGevEZUOzoLxXWRHT1ACOGm+oLY/eDAAAAAElFTkSuQmCC" alt="RT" width="14" height="14" />
                          {rt.Value}
                        </span>
                      );
                    }
                    if (sharedItem.omdbData?.Metascore && sharedItem.omdbData.Metascore !== 'N/A') badges.push(
                      <span key="mc" className="rating-badge meta-badge" title="Metacritic">
                        <span className="meta-score-box">{sharedItem.omdbData.Metascore}</span>
                      </span>
                    );
                    if (badges.length === 0) return null;
                    // Smart row layout: 1=center, 2=L+R, 3=one row, 4=2+2, 5+=2+3
                    const rows = [];
                    if (badges.length <= 3) {
                      rows.push(badges);
                    } else if (badges.length === 4) {
                      rows.push(badges.slice(0, 2));
                      rows.push(badges.slice(2, 4));
                    } else {
                      rows.push(badges.slice(0, 2));
                      rows.push(badges.slice(2));
                    }
                    return (
                      <div className="poster-ratings-container">
                        {rows.map((row, ri) => (
                          <div key={ri} className={`poster-ratings poster-ratings-${row.length}`}>{row}</div>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="shared-modal-poster-frame">
                    {sharedItem.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w342${sharedItem.poster_path}`} alt={sharedItem.title} />
                    ) : (
                      <div className="shared-modal-no-poster">No Poster</div>
                    )}
                    {/* Overlay icons on poster — same as card */}
                    {user && (
                      <div
                        className={`watchlist-overlay ${watchlist[sharedItem.id] ? 'in-watchlist' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleWatchlist(sharedItem.id, sharedItem); }}
                        title={watchlist[sharedItem.id] ? 'Remove from watchlist' : 'Add to watchlist'}
                        style={{position:'absolute',top:6,right:6,background:'rgba(0,0,0,0.5)',borderRadius:'50%',width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',border:'1px solid rgba(255,255,255,0.3)'}}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={watchlist[sharedItem.id] ? '#facc15' : 'none'} stroke="white" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                      </div>
                    )}
                    {user && (
                      <div
                        style={{position:'absolute',bottom:6,left:6,background:'rgba(0,0,0,0.5)',borderRadius:'50%',width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',border:'1px solid rgba(255,255,255,0.3)'}}
                        onClick={(e) => { e.stopPropagation(); toggleWatched(sharedItem.id); }}
                        title={watchedMovies[sharedItem.id] ? "Remove from Watched" : "Mark as Watched"}
                      >
                        {watchedMovies[sharedItem.id] ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </div>
                    )}
                    <div
                      style={{position:'absolute',bottom:6,right:6,background:'rgba(0,0,0,0.5)',borderRadius:'50%',width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',border:'1px solid rgba(255,255,255,0.3)'}}
                      onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(sharedItem.title + ' ' + (sharedItem.release_date?.split('-')[0] || '') + (sharedItem.media_type === 'tv' ? ' TV show' : ' movie'))}`, '_blank'); }}
                      title="Search on Google"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                    </div>
                  </div>
                  {/* Rating buttons below poster — 3 only */}
                  {user && (
                    <div className="shared-modal-rating-btns">
                      <button
                        onClick={() => { markAsWatched(sharedItem.id, 'dislike'); }}
                        className={`rating-btn ${watchedMovies[sharedItem.id]?.rating === 'dislike' ? 'active-dislike' : ''}`}
                        title="Dislike"
                      >👎</button>
                      <button
                        onClick={() => { markAsWatched(sharedItem.id, 'like'); }}
                        className={`rating-btn ${watchedMovies[sharedItem.id]?.rating === 'like' ? 'active-like' : ''}`}
                        title="Like"
                      >👍</button>
                      <button
                        onClick={() => { markAsWatched(sharedItem.id, 'superlike'); }}
                        className={`rating-btn ${watchedMovies[sharedItem.id]?.rating === 'superlike' ? 'active-superlike' : ''}`}
                        title="Superlike"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill={watchedMovies[sharedItem.id]?.rating === 'superlike' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                <div className="shared-modal-info">
                  <div className="shared-modal-title-row">
                    <h2>{sharedItem.title}</h2>
                  </div>
                  {sharedItem.tagline && <p className="shared-modal-tagline">{sharedItem.tagline}</p>}

                  {/* Meta line: cert · release date · runtime · seasons */}
                  <div className="shared-modal-meta-row">
                    <div className="shared-modal-meta-left">
                      {(() => {
                        const items = [];
                        if (sharedItem.certification) items.push(<span key="cert" className="shared-modal-cert">{sharedItem.certification}</span>);
                        if (sharedItem.release_date) items.push(<span key="date">{new Date(sharedItem.release_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>);
                        if (sharedItem.runtime > 0) items.push(<span key="rt">{Math.floor(sharedItem.runtime / 60)}h {sharedItem.runtime % 60}m</span>);
                        if (sharedItem.media_type === 'tv' && sharedItem.number_of_seasons) items.push(<span key="seasons">{sharedItem.number_of_seasons} season{sharedItem.number_of_seasons > 1 ? 's' : ''}</span>);
                        if (sharedItem.original_language) items.push(
                          <span key="lang" className="shared-modal-lang-badge shared-modal-link" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); searchMoviesByLanguage(sharedItem.original_language); }}>
                            {sharedItem.spoken_languages?.find(l => l.iso_639_1 === sharedItem.original_language)?.english_name || sharedItem.original_language.toUpperCase()}
                          </span>
                        );
                        return items.map((item, i) => <span key={i}>{i > 0 && <span className="meta-dot"> · </span>}{item}</span>);
                      })()}
                    </div>
                  </div>

                  {/* Genres — clickable, dot-separated */}
                  {sharedItem.genres && sharedItem.genres.length > 0 && (
                    <p className="shared-modal-genres">
                      {sharedItem.genres.map((g, i) => (
                        <span key={g.id}>
                          <span className="shared-modal-link" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); searchMoviesByGenre(g.name); }}>{g.name}</span>
                          {i < sharedItem.genres.length - 1 && ' · '}
                        </span>
                      ))}
                    </p>
                  )}

                  {/* Tag pills: Language + Release date, then description */}
                  {/* Description */}
                  <p className="shared-modal-overview">
                    {sharedItem.media_type === 'tv' && sharedItem.status && (
                      <span className="shared-modal-tag">{sharedItem.status}</span>
                    )}
                    {sharedItem.media_type === 'tv' && sharedItem.status ? ' ' : ''}{sharedItem.overview}
                  </p>

                  {/* Watch providers — moved to actions row below */}

                  {/* Director — clickable */}
                  {sharedItem.credits?.crew?.find(c => c.job === 'Director') && (
                    <p className="shared-modal-cast"><strong>Director:</strong> {sharedItem.credits.crew.filter(c => c.job === 'Director').map((d, i, arr) => (
                      <span key={d.id}>
                        <span className="shared-modal-link" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); setSearchTerm(d.name); setSearchCategory('Director'); searchMoviesByDirector(d.name); }}>{d.name}</span>
                        {i < arr.length - 1 && ', '}
                      </span>
                    ))}</p>
                  )}

                  {/* Cast — clickable */}
                  {sharedItem.credits?.cast?.length > 0 && (
                    <p className="shared-modal-cast"><strong>Cast:</strong> {sharedItem.credits.cast.slice(0, 8).map((c, i, arr) => (
                      <span key={c.id}>
                        <span className="shared-modal-link" onClick={() => { setSharedItem(null); window.history.replaceState(null, '', window.location.pathname); setSearchTerm(c.name); setSearchCategory('Cast'); searchMoviesByCast(c.name); }}>{c.name}</span>
                        {i < arr.slice(0, 8).length - 1 && ', '}
                      </span>
                    ))}</p>
                  )}

                  <div className="shared-modal-actions">
                    {/* Provider logos */}
                    {sharedItem.watchProviders && (() => {
                      const wp = sharedItem.watchProviders[selectedCountry] || sharedItem.watchProviders['US'];
                      if (!wp) return null;
                      // Normalize: strip "with Ads", "basic", channel suffixes ("Apple TV Channel", "Roku Channel", etc.)
                      const normalize = (name) => name
                        .replace(/\s+(standard\s+)?with\s+ads$/i, '')
                        .replace(/\s+basic$/i, '')
                        .replace(/\s+(apple tv|roku|amazon)\s+channel$/i, '')
                        .replace(/\+/g, ' Plus')  // Paramount+ → Paramount Plus for consistent key
                        .replace(/\s+/g, ' ')
                        .trim();
                      const providers = {};
                      const capLabels = { W: 'Watch', R: 'Rent', B: 'Buy' };
                      const addProv = (items, cap) => (items || []).forEach(p => {
                        const b = normalize(p.provider_name);
                        // Deduplicate by resolved URL — same platform URL = same provider
                        const url = getModalProviderUrl(b, sharedItem.title);
                        const dedup = Object.values(providers).find(existing => getModalProviderUrl(existing.name, sharedItem.title) === url);
                        if (dedup) {
                          dedup.caps.add(cap);
                          if (!dedup.logo && p.logo_path) dedup.logo = p.logo_path;
                        } else {
                          providers[b] = { caps: new Set([cap]), logo: p.logo_path, name: b };
                        }
                      });
                      addProv(wp.flatrate, 'W'); addProv(wp.ads, 'W'); addProv(wp.rent, 'R'); addProv(wp.buy, 'B');
                      const entries = Object.values(providers);
                      if (entries.length === 0) return null;
                      return entries.map(({ name, caps, logo }) => {
                        const capOrder = ['W', 'B', 'R'];
                        const capArr = capOrder.filter(c => caps.has(c));
                        const label = capArr.map(c => capLabels[c]).join('/');
                        return (
                          <a key={name} href={getModalProviderUrl(name, sharedItem.title)} target="_blank" rel="noopener noreferrer" className="provider-logo-item" title={`${name} — ${label}`}>
                            {logo ? (
                              <img src={`https://image.tmdb.org/t/p/w45${logo}`} alt={name} className="provider-logo-img" />
                            ) : (
                              <span className="provider-logo-fallback">{name.charAt(0)}</span>
                            )}
                            <span className="provider-cap-label">{label}</span>
                          </a>
                        );
                      });
                    })()}
                    {/* Share button — right-aligned via margin-left:auto */}
                    <button className="shared-modal-share-btn" title="Share this title" onClick={(e) => {
                      e.stopPropagation();
                      const mediaType = sharedItem.media_type === 'tv' ? 'tv' : 'movie';
                      const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
                      const url = `${base}/#/${mediaType}/${sharedItem.id}`;
                      if (navigator.share) {
                        navigator.share({ title: sharedItem.title, url }).catch(() => {});
                      } else {
                        navigator.clipboard.writeText(url).then(() => {
                          const btn = e.currentTarget;
                          btn.classList.add('share-copied');
                          setTimeout(() => btn.classList.remove('share-copied'), 1500);
                        });
                      }
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {authLoading ? (
        <div className="loading-screen">
          <h2>Loading...</h2>
        </div>
      ) : (
        <>
          <header>
            <nav className="header-bar">
              <h1 className="brand">Tasteful</h1>
              <div className="nav-center">
                <button 
                  onClick={handleHomeClick} 
                  className={`nav-btn ${currentView === 'home' ? 'active' : ''}`}
                >Home</button>
                <button 
                  onClick={() => setCurrentView('ratings')} 
                  className={`nav-btn ${currentView === 'ratings' ? 'active' : ''}`}
                >Ratings</button>
                <button 
                  onClick={() => setCurrentView('watchlist')} 
                  className={`nav-btn ${currentView === 'watchlist' ? 'active' : ''}`}
                >Watchlist</button>
                <button 
                  onClick={() => setCurrentView('mycontent')} 
                  className={`nav-btn ${currentView === 'mycontent' ? 'active' : ''}`}
                >My Content</button>
              </div>
              {/* ─── Mobile settings gear (visible < 768px, replaces all header-right items) ─── */}
              <div className="mobile-settings-wrapper">
                <button
                  className="mobile-settings-btn"
                  onClick={() => setShowMobileSettings(!showMobileSettings)}
                  aria-label="Settings"
                  aria-expanded={showMobileSettings}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                {showMobileSettings && (
                  <div className="mobile-settings-menu">
                    <div className="mobile-settings-item">
                      <span>Country</span>
                      <select 
                        value={selectedCountry} 
                        onChange={(e) => setSelectedCountry(e.target.value)}
                        className="mobile-settings-select"
                      >
                        {countries.map(c => (
                          <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                        ))}
                      </select>
                    </div>
                    <button className="mobile-settings-item" onClick={() => { toggleTheme(); setShowMobileSettings(false); }}>
                      <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></> : <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>}</svg>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                    </button>
                    {user && (
                      <button className="mobile-settings-item" onClick={() => { handleExportBackup(); setShowMobileSettings(false); }}>
                        <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download backup</span>
                      </button>
                    )}
                    <button className="mobile-settings-item mobile-settings-signout" onClick={() => { if (user) signOut(auth); else setShowAuth(true); setShowMobileSettings(false); }}>
                      <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>{user ? 'Sign Out' : 'Sign In'}</span>
                    </button>
                  </div>
                )}
              </div>
              {/* ─── Desktop header-right (hidden < 768px) ─── */}
              <div className="header-right">
                <div className="country-selector">
                  <select 
                    value={selectedCountry} 
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="country-dropdown"
                    title="Select country for streaming availability"
                  >
                    {countries.map(c => (
                      <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                    ))}
                  </select>
                  <span className="country-flag-display">{getCountryFlag(selectedCountry)} <span className="country-arrow">▾</span></span>
                </div>
                {/* Theme toggle — always outside auth buttons so it can sit beside brand on mobile */}
                <button onClick={toggleTheme} className="auth-btn theme-toggle" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle theme">
                  <svg className="sun-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                  <svg className="moon-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                </button>
                {user ? (
                  <span className="auth-buttons" style={{display: 'flex', gap: '6px', alignItems: 'center'}}>
                    <button onClick={handleExportBackup} className="auth-btn backup-btn" title="Download backup of your ratings">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      <span className="btn-label">Backup</span>
                    </button>
                    {/* Restore button hidden — planned for future admin page. Handler kept: handleImportBackup */}
                    {false && (
                      <button onClick={handleImportBackup} className="auth-btn" title="Restore from a backup file">📤 Restore</button>
                    )}
                    <button onClick={() => signOut(auth)} className="auth-btn signout-btn">Sign Out</button>
                  </span>
                ) : (
                  <span className="auth-buttons" style={{display: 'flex', gap: '6px', alignItems: 'center'}}>
                    <button onClick={() => setShowAuth(true)} className="auth-btn signout-btn">Sign In</button>
                  </span>
                )}
              </div>
            </nav>
          </header>

          <main>
            {/* Editorial hero — Home view only */}
            {currentView === 'home' && (
              <div className="intro-hero">
                <h1>Films worth <em>your</em> time</h1>
                <p>A personal library, curated by you. Rate, revisit, refine.</p>
              </div>
            )}
            {/* Global Search Panel - Available on all pages */}
            <div className="filters">
              <div className="search-section">
                {/* Search bar row: search input + filter button side-by-side (mockup layout) */}
                <div className="tf-search-bar">
                  <div className="tf-search-input">
                    <svg className="tf-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <select
                      value={searchCategory}
                      onChange={(e) => setSearchCategory(e.target.value)}
                      className="tf-search-category"
                      aria-label="Search category"
                    >
                      <option value="Content">Content</option>
                      <option value="Cast">Cast</option>
                      <option value="Director">Director</option>
                    </select>
                    <input
                      type="text"
                      placeholder={`Search ${searchCategory === 'Content' ? 'movies & shows' : searchCategory.toLowerCase() + 's'}…`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && performSearch()}
                      className="tf-search-field"
                    />
                    <button className="tf-search-submit" onClick={performSearch} aria-label="Search">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                  </div>
                  <button className="tf-filter-btn" onClick={() => setShowFilters(!showFilters)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                    Filters
                    {(selectedGenres.length + (selectedRating ? 1 : 0) + (minRating > 0 ? 1 : 0) + (selectedLanguage ? 1 : 0)) > 0 && (
                      <span className="tf-filter-badge">{selectedGenres.length + (selectedRating ? 1 : 0) + (minRating > 0 ? 1 : 0) + (selectedLanguage ? 1 : 0)}</span>
                    )}
                  </button>
                </div>

                {/* Chip row: media type + scope (mockup layout) */}
                <div className="tf-chips">
                  <button
                    className={`tf-chip ${mediaType === 'all' ? 'active' : ''}`}
                    onClick={() => { setMediaType('all'); setSelectedGenres([]); }}
                  >All</button>
                  <button
                    className={`tf-chip ${mediaType === 'movie' ? 'active' : ''}`}
                    onClick={() => { setMediaType('movie'); setSelectedGenres([]); }}
                  >Movies</button>
                  <button
                    className={`tf-chip ${mediaType === 'tv' ? 'active' : ''}`}
                    onClick={() => { setMediaType('tv'); setSelectedGenres([]); }}
                  >Shows</button>
                  <span className="tf-chip-divider" aria-hidden="true"></span>
                  <button
                    className={`tf-chip ${searchScope.ratedOnly ? 'active' : ''}`}
                    onClick={() => {
                      const newVal = !searchScope.ratedOnly;
                      if (newVal) {
                        setSearchScope({ratedOnly: true, watchlistedOnly: false, watchedOnly: false});
                        setCurrentView('ratings');
                      } else {
                        setSearchScope({ratedOnly: false, watchlistedOnly: false, watchedOnly: false});
                        setCurrentView('home');
                      }
                    }}
                  >Rated</button>
                  <button
                    className={`tf-chip ${searchScope.watchlistedOnly ? 'active' : ''}`}
                    onClick={() => {
                      const newVal = !searchScope.watchlistedOnly;
                      const newScope = {ratedOnly: false, watchlistedOnly: newVal, watchedOnly: searchScope.watchedOnly};
                      setSearchScope(newScope);
                      if (!newVal && !newScope.watchedOnly) setCurrentView('home');
                      else if (newVal && !newScope.watchedOnly) setCurrentView('watchlist');
                    }}
                  >Watchlisted</button>
                  <button
                    className={`tf-chip ${searchScope.watchedOnly ? 'active' : ''}`}
                    onClick={() => {
                      const newVal = !searchScope.watchedOnly;
                      const newScope = {ratedOnly: false, watchlistedOnly: searchScope.watchlistedOnly, watchedOnly: newVal};
                      setSearchScope(newScope);
                      if (!newVal && !newScope.watchlistedOnly) setCurrentView('home');
                      else if (newVal && !newScope.watchlistedOnly) setCurrentView('watchlist');
                    }}
                  >Watched</button>
                  <span className="tf-chip-separator">|</span>
                  <button
                    className={`tf-chip ${excludeTalkShows ? 'active' : ''}`}
                    onClick={() => setExcludeTalkShows(prev => !prev)}
                    title="Exclude Talk Shows from results (TMDB genre 10767)"
                  >Exclude Talk Shows</button>
                </div>

                {/* Legacy hidden containers — kept in DOM for compat but hidden. React state above drives them. */}
                <div className="input-group" style={{ display: 'none' }} aria-hidden="true">
                  <div className="input-group-btn">
                    <select value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)} className="search-category">
                      <option value="Content">Content</option>
                      <option value="Cast">Cast</option>
                      <option value="Director">Director</option>
                    </select>
                  </div>
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
                  <button className="search-btn" onClick={performSearch}>🔍</button>
                </div>
                <div className="search-scope" style={{ display: 'none' }} aria-hidden="true">
                  {/* Hidden — chips above drive the state. Kept to satisfy any legacy CSS. */}
                </div>
              </div>

                {/* Collapsible Filters Section (unchanged — same handlers) */}
                <div className={`filters-content ${showFilters ? 'show' : 'hide'}`}>
                {/* Genre Filters */}
                <div className="genre-section">
                  <h3>Genres</h3>
                  <div className="genre-list">
                    {showAllGenres ? (
                      <>
                        {activeGenres.map(genre => (
                          <label key={genre.id} className="genre-item">
                            <input
                              type="checkbox"
                              checked={selectedGenres.includes(genre.id)}
                              onChange={() => toggleGenre(genre.id)}
                            />
                            <span className="genre-name">{genre.name}</span>
                          </label>
                        ))}
                        <label className="genre-item hide-genres-item" onClick={() => setShowAllGenres(false)}>
                          <div className="minus-checkbox">−</div>
                          <span className="genre-btn">
                            Hide Genres
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        {activeGenres.slice(0, 8).map(genre => (
                          <label key={genre.id} className="genre-item">
                            <input
                              type="checkbox"
                              checked={selectedGenres.includes(genre.id)}
                              onChange={() => toggleGenre(genre.id)}
                            />
                            <span className="genre-name">{genre.name}</span>
                          </label>
                        ))}
                        {activeGenres.length > 8 && (
                          <label className="genre-item more-genres-item" onClick={() => setShowAllGenres(true)}>
                            <div className="plus-checkbox">+</div>
                            <span className="genre-btn">
                              More Genres
                            </span>
                          </label>
                        )}
                      </>
                    )}
                  </div>
                </div>


                {/* Filter Row - Year, Rating, Content, Language in one row */}
                <div className="filter-row">
                  {/* Year Range Filter */}
                  <div className="filter-group">
                    <h3>Year Range</h3>
                    <div className="year-inputs">
                      <select 
                        value={yearRange.min} 
                        onChange={(e) => setYearRange({...yearRange, min: parseInt(e.target.value)})}
                      >
                        {Array.from({length: currentYear - 1900 + 1}, (_, i) => currentYear - i).map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                      <span>to</span>
                      <select 
                        value={yearRange.max} 
                        onChange={(e) => setYearRange({...yearRange, max: parseInt(e.target.value)})}
                      >
                        {Array.from({length: currentYear - 1900 + 1}, (_, i) => currentYear - i).map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Content Rating Filter */}
                  <div className="filter-group">
                    <h3>Content Rating</h3>
                    <select value={selectedRating} onChange={(e) => setSelectedRating(e.target.value)}>
                      <option value="">All Ratings</option>
                      <option value="G">G</option>
                      <option value="PG">PG</option>
                      <option value="PG-13">PG-13</option>
                      <option value="R">R</option>
                      <option value="NC-17">NC-17</option>
                    </select>
                  </div>

                  {/* Minimum Rating Filter */}
                  <div className="filter-group">
                    <h3>Minimum Rating {minRating}/10</h3>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      step="0.5"
                      value={minRating}
                      onChange={(e) => setMinRating(parseFloat(e.target.value))}
                      className="rating-slider"
                    />
                  </div>

                  {/* Language Filter */}
                  <div className="filter-group">
                    <h3>Language</h3>
                    <select value={selectedLanguage} onChange={(e) => setSelectedLanguage(e.target.value)}>
                      <option value="">All Languages</option>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                      <option value="te">Telugu</option>
                      <option value="ta">Tamil</option>
                      <option value="ml">Malayalam</option>
                      <option value="bn">Bengali</option>
                      <option value="gu">Gujarati</option>
                      <option value="mr">Marathi</option>
                      <option value="kn">Kannada</option>
                      <option value="ne">Nepali</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="pt">Portuguese</option>
                      <option value="ru">Russian</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="zh">Chinese</option>
                      <option value="ar">Arabic</option>
                      <option value="nl">Dutch</option>
                      <option value="sv">Swedish</option>
                      <option value="th">Thai</option>
                      <option value="tr">Turkish</option>
                      <option value="other">Other Languages</option>
                    </select>
                  </div>
                </div>
                </div>
                {/* End of collapsible filters */}
            </div>
            {/* End of filters grey box */}

            {currentView === 'home' && (
              <>
                {(directorSearch || castSearch || genreSearch || languageSearch) && (
                  <div className="search-info">
                    <p>
                      Showing movies by {
                        directorSearch ? `director: ${directorSearch}` :
                        castSearch ? `actor: ${castSearch}` :
                        genreSearch ? `genre: ${genreSearch}` :
                        `language: ${languageSearch}`
                      }
                      <button onClick={clearPersonSearch} className="clear-search">Clear</button>
                    </p>
                  </div>
                )}
            
            {movies.length > 0 && (
              <div className="results-header">
                <h2 className="tf-results-count">{movies.length} titles</h2>
                <div className="sort-section">
                  <label htmlFor="sort-select">Sort by</label>
                  <select 
                    id="sort-select"
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value)}
                    className="sort-select tf-sort-dropdown"
                    disabled={isSorting}
                  >
                    <option value="popularity">popularity</option>
                    <option value="title-asc">title (A-Z)</option>
                    <option value="title-desc">title (Z-A)</option>
                    <option value="year-desc">newest first</option>
                    <option value="year-asc">oldest first</option>
                    <option value="rating-desc">highest rating</option>
                    <option value="rotten-tomatoes">rotten tomatoes</option>
                    <option value="runtime-desc">longest runtime</option>
                    <option value="runtime-asc">shortest runtime</option>
                  </select>
                  {isSorting && <span style={{marginLeft: '10px', fontSize: '14px'}}>Sorting...</span>}
                </div>
              </div>
            )}
            
            <div className="movies-grid">
              {movies.length === 0 ? (
                <div className="no-results">
                  <p>No movies found. Try adjusting your search terms or filters.</p>
                </div>
              ) : (
                (isSorting ? movies : sortedMovies).filter(movie => !excludeTalkShows || !(movie.genre_ids || []).includes(10767)).map(movie => (
                  <MovieCard
                    key={`${movie.media_type || 'movie'}-${movie.id}`}
                    movie={movie}
                    isWatched={watchedMovies[movie.id]}
                    isInWatchlist={!!watchlist[movie.id]}
                    isWatchedOnly={!!watchedMovies[movie.id]}
                    onMarkWatched={markAsWatched}
                    onToggleWatchlist={toggleWatchlist}
                    onToggleWatched={toggleWatched}
                    getMovieDetails={getMovieDetails}
                    selectedCountry={selectedCountry}
                    onDirectorClick={(directorName) => {
                      setSearchTerm(directorName);
                      setSearchCategory('Director');
                      searchMoviesByDirector(directorName);
                    }}
                    onCastClick={(actorName) => {
                      setSearchTerm(actorName);
                      setSearchCategory('Cast');
                      searchMoviesByCast(actorName);
                    }}
                    onGenreClick={(genreName) => {
                      searchMoviesByGenre(genreName);
                    }}
                    onLanguageClick={(languageCode) => {
                      searchMoviesByLanguage(languageCode);
                    }}
                    onOpenModal={(movieId, mediaType) => openMovieModal(movieId, mediaType)}
                  />
                ))
              )}
            </div>

            {movies.length > 0 && (
              <div className="pagination">
                <button 
                  onClick={fetchPreviousPage}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                
                <span className="page-info">
                  Page {currentPage}
                </span>
                
                <button 
                  onClick={fetchNextPage}
                >
                  Next
                </button>
              </div>
            )}
              </>
            )}

      {/* Other Views */}
      {currentView === 'watchlist' && (
        <WatchlistView 
          watchlist={watchlist} 
          watchedMovies={watchedMovies}
          onToggleWatchlist={toggleWatchlist}
          onToggleWatched={toggleWatched}
          onMarkWatched={markAsWatched}
          getMovieDetails={getMovieDetails}
          globalSearchTerm={searchTerm}
          searchScope={searchScope}
          selectedGenres={selectedGenres}
          selectedLanguage={selectedLanguage}
          selectedRating={selectedRating}
          minRating={minRating}
          yearRange={yearRange}
          moviesDatabase={moviesDatabase}
          onNavigateSearch={navigateAndSearch}
          ratingHistory={ratingHistory}
          selectedCountry={selectedCountry}
          mediaType={mediaType}
          defaultTab={searchScope.watchedOnly && !searchScope.watchlistedOnly ? 'watched' : 'shortlisted'}
          onOpenModal={openMovieModal}
        />
      )}
      
      {currentView === 'ratings' && (
        <MyRatingsView 
          watchedMovies={watchedMovies} 
          onMarkWatched={markAsWatched} 
          onToggleWatched={toggleWatched}
          getMovieDetails={getMovieDetails}
          globalSearchTerm={searchTerm}
          searchScope={searchScope}
          selectedGenres={selectedGenres}
          selectedLanguage={selectedLanguage}
          selectedRating={selectedRating}
          minRating={minRating}
          yearRange={yearRange}
          moviesDatabase={moviesDatabase}
          onNavigateSearch={navigateAndSearch}
          selectedCountry={selectedCountry}
          mediaType={mediaType}
          onOpenModal={openMovieModal}
        />
      )}

      {currentView === 'mycontent' && (
        <MyContentView
          watchedMovies={watchedMovies}
          watchlist={watchlist}
          moviesDatabase={moviesDatabase}
          getMovieDetails={getMovieDetails}
          onMarkWatched={markAsWatched}
          onToggleWatchlist={toggleWatchlist}
          onToggleWatched={toggleWatched}
          selectedCountry={selectedCountry}
          mediaType={mediaType}
          onNavigateSearch={navigateAndSearch}
          tmdbApiKey={TMDB_API_KEY}
          onOpenModal={openMovieModal}
        />
      )}
      </main>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button className="scroll-top-btn" onClick={scrollToTop} title="Scroll to top">
          <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor">
            <path d="M8 0L16 10H0L8 0Z"/>
          </svg>
        </button>
      )}

      {/* Authentication Modal */}
      {showAuth && (
        <div className="auth-modal">
          <div className="auth-modal-content">
            <button className="close-btn" onClick={() => setShowAuth(false)}>×</button>
            <AuthComponent user={user} onAuthChange={setUser} />
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function MovieCard({ movie, isWatched, isInWatchlist, isWatchedOnly, onMarkWatched, onToggleWatchlist, onToggleWatched, getMovieDetails, onDirectorClick, onCastClick, onGenreClick, onLanguageClick, onOpenModal, showRatingDate, showWatchlistDate, watchlistDate, selectedCountry }) {
  const [details, setDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);

  const getLanguageName = (code) => {
    const languages = {
      'en': 'English', 'hi': 'Hindi', 'te': 'Telugu', 'ta': 'Tamil',
      'gu': 'Gujarati', 'ml': 'Malayalam', 'mr': 'Marathi', 'kn': 'Kannada',
      'bn': 'Bengali', 'th': 'Thai', 'id': 'Indonesian', 'fr': 'French',
      'es': 'Spanish', 'de': 'German', 'it': 'Italian', 'ja': 'Japanese',
      'ko': 'Korean', 'zh': 'Chinese (Mandarin)', 'pt': 'Portuguese',
      'ru': 'Russian', 'ar': 'Arabic', 'tr': 'Turkish', 'sv': 'Swedish',
      'da': 'Danish', 'no': 'Norwegian', 'nl': 'Dutch', 'pl': 'Polish',
      'fi': 'Finnish', 'sr': 'Serbian', 'cs': 'Czech', 'hu': 'Hungarian',
      'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak',
      'sl': 'Slovenian', 'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian',
      'is': 'Icelandic', 'mt': 'Maltese', 'cy': 'Welsh', 'ga': 'Irish',
      'he': 'Hebrew', 'fa': 'Persian', 'ur': 'Urdu', 'vi': 'Vietnamese',
      'ms': 'Malay', 'tl': 'Filipino', 'sw': 'Swahili', 'am': 'Amharic'
    };
    return languages[code] || code?.toUpperCase() || 'Unknown';
  };

  const loadDetails = async () => {
    if (!details) {
      const movieDetails = await getMovieDetails(movie.id, movie.media_type);
      setDetails(movieDetails);
    }
    setShowDetails(!showDetails);
  };

  const getProviderUrl = (providerName, title) => {
    const q = encodeURIComponent(title || movie.title || '');
    const urls = {
      'Netflix': `https://www.netflix.com/search?q=${q}`,
      'Amazon Prime Video': `https://www.amazon.com/s?k=${q}&i=instant-video`,
      'Amazon Video': `https://www.amazon.com/s?k=${q}&i=instant-video`,
      'Disney Plus': `https://www.disneyplus.com/search/${q}`,
      'Disney+': `https://www.disneyplus.com/search/${q}`,
      'Hulu': `https://www.hulu.com/search?q=${q}`,
      'Apple TV Plus': `https://tv.apple.com/search?term=${q}`,
      'Apple TV': `https://tv.apple.com/search?term=${q}`,
      'HBO Max': `https://play.max.com/search?q=${q}`,
      'Max': `https://play.max.com/search?q=${q}`,
      'Paramount Plus': `https://www.paramountplus.com/search/?q=${q}`,
      'Paramount+': `https://www.paramountplus.com/search/?q=${q}`,
      'Peacock': `https://www.peacocktv.com/search?q=${q}`,
      'Peacock Premium': `https://www.peacocktv.com/search?q=${q}`,
      'Tubi': `https://tubitv.com/search/${q}`,
      'Crunchyroll': `https://www.crunchyroll.com/search?q=${q}`,
      'Hotstar': `https://www.hotstar.com/in/search?q=${q}`,
      'JioCinema': `https://www.jiocinema.com/search/${q}`,
      'Zee5': `https://www.zee5.com/search?q=${q}`,
      'SonyLIV': `https://www.sonyliv.com/search?q=${q}`,
      'YouTube': `https://www.youtube.com/results?search_query=${q}`,
      'Google Play Movies': `https://play.google.com/store/search?q=${q}&c=movies`,
      'Vudu': `https://www.vudu.com/content/movies/search?searchString=${q}`,
    };
    return urls[providerName] || `https://www.justwatch.com/us/search?q=${q}`;
  };

  const renderProviderLink = (text, title) => {
    // Extract base name (before any parenthetical like "(Ads)")
    const baseName = text.replace(/\s*\(.*\)$/, '');
    const url = getProviderUrl(baseName, title);
    return (
      <a key={text} href={url} target="_blank" rel="noopener noreferrer" 
        onClick={(e) => e.stopPropagation()}
        style={{ color: '#0066cc', textDecoration: 'underline', cursor: 'pointer' }}
      >{text}</a>
    );
  };

  const truncateDescription = (text, wordLimit = 50) => {
    if (!text) return '';
    const words = text.split(' ');
    if (words.length <= wordLimit) return text;
    return words.slice(0, wordLimit).join(' ');
  };

  const renderDescription = () => {
    if (!details?.overview) return '';
    
    const fullDescription = details.overview;
    const truncatedDescription = truncateDescription(fullDescription, 50);
    const needsTruncation = fullDescription.split(' ').length > 50;
    
    if (!needsTruncation) {
      return fullDescription;
    }
    
    return (
      <>
        {showFullDescription ? fullDescription : truncatedDescription}
        <span 
          onClick={(e) => { 
            e.stopPropagation(); 
            const wasExpanded = showFullDescription;
            setShowFullDescription(!showFullDescription);
            // Fix scroll visibility when collapsing
            if (wasExpanded) {
              setTimeout(() => {
                const detailsContent = e.target.closest('.details-content');
                if (detailsContent) {
                  // Force complete reset
                  detailsContent.style.overflowY = 'hidden';
                  detailsContent.scrollTop = 0;
                  // Wait for DOM to update, then restore overflow
                  setTimeout(() => {
                    detailsContent.style.overflowY = 'auto';
                  }, 100);
                }
              }, 0);
            }
          }}
          style={{ 
            cursor: 'pointer', 
            color: '#666', 
            fontWeight: 'bold',
            marginLeft: '5px'
          }}
        >
          {showFullDescription ? '(-less)' : '(+more)'}
        </span>
      </>
    );
  };

  // Get current rating (handle both old string format and new object format)
  const currentRating = isWatched ? (typeof isWatched === 'object' ? isWatched.rating : isWatched) : null;

  // Skip rendering if movie data is invalid
  if (!movie || !movie.id || (!movie.title && !movie.name)) return null;

  return (
    <div className="movie-card">
      {/* Poster container supports two view modes:
          - CURRENT (modal): clicking poster opens a full-screen detail modal via onOpenModal()
          - LEGACY (flip): clicking poster flips the card to show a detail pane on the back
          The flip mode activates when onOpenModal is NOT provided (e.g., in sub-views without the prop).
          The poster-back div below contains the complete legacy flip detail view — 
          streaming providers, genres, cast, ratings, description — all fully functional.
          To re-enable flip as default: remove the `&& !onOpenModal` condition below. */}
      <div className={`poster-container ${showDetails && !onOpenModal ? 'flipped' : ''}`}>
        <div className="poster-flip-inner">
          {/* Front of card - Movie poster */}
          <div className="poster-front">
            <img
              src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
              alt={movie.title}
              onClick={() => onOpenModal ? onOpenModal(movie.id, movie.media_type || 'movie') : loadDetails()} /* modal mode; legacy flip: use just loadDetails() */
              className="movie-poster"
            />
            <div 
              className="rating-overlay"
              title={`TMDB Rating: ${(movie.vote_average || 0).toFixed(1)}`}
            >
              {(movie.vote_average || 0).toFixed(1)}
            </div>
            {onToggleWatchlist && (
              <div 
                className="wishlist-overlay"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatchlist(movie.id);
                }}
                title={isInWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}
              >
                {showWatchlistDate ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#facc15" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                ) : isInWatchlist ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#facc15" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                )}
              </div>
            )}
            {onToggleWatched && (
              <div 
                className="watched-overlay"
                onClick={(e) => {
                  console.log('Watched overlay clicked for movie:', movie.id);
                  e.stopPropagation();
                  onToggleWatched(movie.id);
                }}
                title={isWatchedOnly ? "Remove from Watched" : "Add to Watched"}
              >
                {isWatchedOnly ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3" fill="white"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </div>
            )}
            <div 
              className="google-search-overlay"
              onClick={(e) => {
                e.stopPropagation();
                const year = movie.release_date?.split('-')[0] || '';
                const searchTerm = `${movie.title}${year ? ` (${year})` : ''} movie`;
                window.open(`https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`, '_blank');
              }}
              title="Search on Google"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </div>
            {(showRatingDate && isWatched && typeof isWatched === 'object') && (
              <div 
                className="date-overlay-center"
                title={`Rated on: ${new Date(isWatched.ratedAt).toLocaleDateString()}`}
              >
                Rated<br/>{new Date(isWatched.ratedAt).toLocaleDateString()}
              </div>
            )}
            {showWatchlistDate && watchlistDate && (
              <div 
                className="date-overlay-center"
                title={`Added to watchlist on: ${new Date(watchlistDate).toLocaleDateString()}`}
              >
                Added<br/>{new Date(watchlistDate).toLocaleDateString()}
              </div>
            )}
          </div>
          
          {/* Back of card - Movie details */}
          {/* LEGACY FLIP DETAIL VIEW — fully functional, preserved for fallback.
              This is the back of the card that shows when flipped (showDetails && !onOpenModal).
              Contains: streaming providers, description, genres, language, director, cast, ratings.
              All elements are clickable (director/cast/genre/language trigger searches).
              To restore as primary: remove `onOpenModal` checks from poster img and h3 onClick handlers,
              and remove `&& !onOpenModal` from the poster-container className above. */}
          <div className="poster-back" onClick={() => onOpenModal ? onOpenModal(movie.id, movie.media_type || 'movie') : loadDetails()}>
            {details && (
              <div className="details-content">
                {/* Streaming Providers - Combined */}
                {details.watchProviders && details.watchProviders[selectedCountry] && (() => {
                  const wp = details.watchProviders[selectedCountry];
                  const streamNames = new Set((wp.flatrate || []).map(p => p.provider_name));
                  const adsNames = new Set((wp.ads || []).map(p => p.provider_name));
                  const rentNames = new Set((wp.rent || []).map(p => p.provider_name));
                  const buyNames = new Set((wp.buy || []).map(p => p.provider_name));
                  
                  // Normalize provider names (e.g., "Netflix Standard with Ads" → "Netflix")
                  const normalize = (name) => name.replace(/\s+(standard\s+)?with\s+ads$/i, '').replace(/\s+basic$/i, '').trim();
                  
                  // Build deduplicated provider maps: baseName → set of capabilities
                  const providerCaps = {};
                  const addCap = (names, cap) => {
                    for (const name of names) {
                      const base = normalize(name);
                      if (!providerCaps[base]) providerCaps[base] = new Set();
                      providerCaps[base].add(cap);
                    }
                  };
                  addCap(streamNames, 'stream');
                  addCap(adsNames, 'ads');
                  addCap(rentNames, 'rent');
                  addCap(buyNames, 'buy');
                  
                  // Watch line: stream + ads providers
                  const watchProviders = Object.entries(providerCaps)
                    .filter(([, caps]) => caps.has('stream') || caps.has('ads'))
                    .map(([name, caps]) => {
                      if (caps.has('stream') && caps.has('ads')) return name;
                      if (caps.has('ads')) return `${name} (Ads)`;
                      return name;
                    });
                  
                  // Rent/Buy line
                  const rentBuyProviders = Object.entries(providerCaps)
                    .filter(([, caps]) => caps.has('rent') || caps.has('buy'))
                    .map(([name, caps]) => {
                      if (caps.has('rent') && caps.has('buy')) return name;
                      if (caps.has('rent')) return `${name} (Rent)`;
                      return `${name} (Buy)`;
                    });
                  
                  return (watchProviders.length > 0 || rentBuyProviders.length > 0) ? (
                    <div className="streaming-info">
                      {watchProviders.length > 0 && <p className="stream-line"><span className="stream-icon">🎬</span> <strong>Watch:</strong> {watchProviders.map((p, i) => <span key={p}>{i > 0 && ', '}{renderProviderLink(p, details?.title || movie.title)}</span>)}</p>}
                      {rentBuyProviders.length > 0 && <p className="stream-line"><span className="stream-icon">🎬</span> <strong>Rent/Buy:</strong> {rentBuyProviders.map((p, i) => <span key={p}>{i > 0 && ', '}{renderProviderLink(p, details?.title || movie.title)}</span>)}</p>}
                    </div>
                  ) : null;
                })()}
                {movie.media_type === 'tv' && details.number_of_seasons && (
                  <p><strong>Seasons:</strong> {details.number_of_seasons} | <strong>Episodes:</strong> {details.number_of_episodes || 'N/A'} | <strong>Status:</strong> {details.status || 'N/A'}</p>
                )}
                <p><strong>Description:</strong> {details?.omdbData?.Rated && details.omdbData.Rated !== 'N/A' && <><strong>[{details.omdbData.Rated}]</strong> </>}{details?.runtime && <><strong>[</strong><strong><em>{details.runtime} min</em></strong><strong>]</strong> </>}{renderDescription()}</p>
                <div className="genre-language-column">
                  <p><strong>Genre: </strong>{details?.genres?.map((g, index) => (
                    <span key={g.id}>
                      <span 
                        onClick={(e) => { e.stopPropagation(); onGenreClick && onGenreClick(g.name); }}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {g.name}
                      </span>
                      {index < details.genres.length - 1 && ', '}
                    </span>
                  ))}</p>
                  <p><strong>Language: </strong>
                    <span 
                      onClick={(e) => { e.stopPropagation(); onLanguageClick && onLanguageClick(details?.original_language); }}
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      {getLanguageName(details?.original_language)}
                    </span>
                  </p>
                  <p><strong>Director: </strong>{details?.credits?.crew?.filter(person => person.job === 'Director').map((director, index, directors) => (
                    <span key={director.id}>
                      <span 
                        onClick={(e) => { e.stopPropagation(); onDirectorClick && onDirectorClick(director.name); }}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {director.name}
                      </span>
                      {index < directors.length - 1 && ', '}
                    </span>
                  ))}</p>
                  <p><strong>Cast: </strong>{details?.credits?.cast?.slice(0, 10).map((actor, index, cast) => (
                    <span key={actor.id}>
                      <span 
                        onClick={(e) => { e.stopPropagation(); onCastClick && onCastClick(actor.name); }}
                        style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {actor.name}
                      </span>
                      {index < cast.length - 1 && ', '}
                    </span>
                  ))}</p>
                  {details?.release_date && <p><strong>Release Date: </strong>{new Date(details.release_date).toLocaleDateString()}</p>}
                </div>
                {(details?.vote_average || (details?.omdbData?.imdbRating && details.omdbData.imdbRating !== 'N/A') || details?.omdbData?.Ratings?.find(r => r.Source === 'Rotten Tomatoes')) && (
                  <div className="ratings-info">
                    <p>
                      {details?.vote_average && <span><strong>[TMDB: {details.vote_average.toFixed(1)}]</strong> </span>}
                      {details?.omdbData?.imdbRating && details.omdbData.imdbRating !== 'N/A' && <span><strong>[IMDB: {details.omdbData.imdbRating}]</strong> </span>}
                      {details?.omdbData?.Ratings?.find(r => r.Source === 'Rotten Tomatoes') && <span><strong>[RT: {details.omdbData.Ratings.find(r => r.Source === 'Rotten Tomatoes').Value}]</strong></span>}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="movie-title-row">
        <h3 onClick={() => onOpenModal ? onOpenModal(movie.id, movie.media_type || 'movie') : loadDetails()} className="movie-title"> {/* modal mode; legacy flip: use just loadDetails() */}
          {movie.media_type === 'tv' && <span className="media-badge tv-badge">TV</span>}
          {movie.title} [{movie.release_date?.split('-')[0] || 'N/A'}]
        </h3>
        <button
          className="share-btn"
          title="Share this title"
          onClick={(e) => {
            e.stopPropagation();
            const mediaType = movie.media_type === 'tv' ? 'tv' : 'movie';
            const base = window.location.origin + window.location.pathname.replace(/\/$/, '');
            const url = `${base}/#/${mediaType}/${movie.id}`;
            if (navigator.share) {
              navigator.share({ title: movie.title, url }).catch(() => {});
            } else {
              navigator.clipboard.writeText(url).then(() => {
                const btn = e.currentTarget;
                btn.classList.add('share-copied');
                setTimeout(() => btn.classList.remove('share-copied'), 1500);
              });
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </button>
      </div>
      
      <div className="actions">
        <div className="rating-buttons">
          <button 
            onClick={() => onMarkWatched(movie.id, 'dislike')}
            className={`rating-btn ${currentRating === 'dislike' ? 'active-dislike' : ''}`}
          >
            👎
          </button>
          <button 
            onClick={() => onMarkWatched(movie.id, 'like')}
            className={`rating-btn ${currentRating === 'like' ? 'active-like' : ''}`}
          >
            👍
          </button>
          <button 
            onClick={() => onMarkWatched(movie.id, 'superlike')}
            className={`rating-btn ${currentRating === 'superlike' ? 'active-superlike' : ''}`}
            title="Superlike (love)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={currentRating === 'superlike' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </button>
        </div>
      </div>

      {showDetails && details && (
        <div className="movie-details" style={{ display: 'none' }}>
          {/* Hidden - details now shown on card back */}
        </div>
      )}
    </div>
  );
}

function MyRatingsView({ watchedMovies, onMarkWatched, onToggleWatched, getMovieDetails, globalSearchTerm, searchScope, selectedGenres, selectedLanguage, selectedRating, minRating, yearRange, moviesDatabase, onNavigateSearch, selectedCountry, mediaType, onOpenModal }) {
  const [displayMovies, setDisplayMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('date');
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const moviesPerPage = 25;

  // Use global search/filters when scope is enabled, otherwise use local
  const effectiveSearchTerm = searchTerm || globalSearchTerm;
  const effectiveGenres = searchScope?.ratedOnly ? selectedGenres : [];
  const effectiveLanguage = searchScope?.ratedOnly ? selectedLanguage : '';
  const effectiveRating = searchScope?.ratedOnly ? selectedRating : '';
  const effectiveMinRating = searchScope?.ratedOnly ? minRating : 0;
  const effectiveYearRange = searchScope?.ratedOnly ? yearRange : null;

  // Only show movies with actual ratings (not 'watched' only)
  const ratedMovies = Object.fromEntries(
    Object.entries(watchedMovies).filter(([_, data]) => 
      data.rating && data.rating !== 'watched'
    )
  );
  const totalRatedCount = Object.keys(ratedMovies).length;

  // Filter and sort using moviesDatabase (no API calls!)
  const getFilteredMovieIds = () => {
    const entries = Object.entries(ratedMovies);
    
    // Filter using moviesDatabase
    let checkedCount = 0;
    const filtered = entries.filter(([movieId]) => {
      const meta = moviesDatabase?.[movieId];
      
      // Media type filter — default to 'movie' if no metadata
      if (mediaType !== 'all') {
        const itemType = meta?.mediaType || 'movie';
        if (itemType !== mediaType) return false;
      }
      
      if (!meta) return true; // Include if no metadata for other filters
      
      // Log first movie's metadata structure
      if (checkedCount === 0) {
        console.log('Sample movie metadata:', movieId, meta);
        checkedCount++;
      }
      
      // Text search
      if (effectiveSearchTerm?.trim()) {
        const search = effectiveSearchTerm.toLowerCase();
        const matchesTitle = meta.title?.toLowerCase().includes(search);
        const matchesCast = meta.cast?.some(c => c.toLowerCase().includes(search));
        const matchesDirector = meta.directors?.some(d => d.toLowerCase().includes(search));
        if (!matchesTitle && !matchesCast && !matchesDirector) return false;
      }
      
      // Genre filter
      if (effectiveGenres?.length > 0) {
        const hasGenre = effectiveGenres.some(gId => meta.genre_ids?.includes(parseInt(gId)));
        if (!hasGenre) return false;
      }
      
      // Language filter
      if (effectiveLanguage && effectiveLanguage !== '' && effectiveLanguage !== 'all') {
        if (effectiveLanguage === 'other') {
          const commonLangs = ['en', 'hi', 'te', 'ta', 'ml', 'bn', 'gu', 'mr', 'kn', 'ne', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'nl', 'sv', 'th', 'tr'];
          if (commonLangs.includes(meta.language)) return false;
        } else if (meta.language !== effectiveLanguage) return false;
      }
      
      // Content rating filter
      if (effectiveRating && effectiveRating !== '') {
        if (meta.contentRating !== effectiveRating) return false;
      }
      
      // Min TMDB rating filter
      if (effectiveMinRating && effectiveMinRating > 0) {
        if (!meta.tmdb_rating || meta.tmdb_rating < effectiveMinRating) return false;
      }
      
      // Year range filter
      if (effectiveYearRange?.min || effectiveYearRange?.max) {
        const year = meta.year;
        if (year) {
          if (effectiveYearRange.min && year < effectiveYearRange.min) return false;
          if (effectiveYearRange.max && year > effectiveYearRange.max) return false;
        }
      }
      
      return true;
    });
    
    // Sort
    filtered.sort((a, b) => {
      const metaA = moviesDatabase?.[a[0]];
      const metaB = moviesDatabase?.[b[0]];
      const ratingDataA = a[1];
      const ratingDataB = b[1];
      const dateA = typeof ratingDataA === 'object' ? new Date(ratingDataA.ratedAt) : 0;
      const dateB = typeof ratingDataB === 'object' ? new Date(ratingDataB.ratedAt) : 0;
      
      switch (sortBy) {
        case 'date': return dateB - dateA;
        case 'date-asc': return dateA - dateB;
        case 'title-asc': return (metaA?.title || '').localeCompare(metaB?.title || '');
        case 'title-desc': return (metaB?.title || '').localeCompare(metaA?.title || '');
        case 'rating-desc':
          const order = { 'superlike': 3, 'like': 2, 'dislike': 1, 'watched': 0 };
          const rA = typeof ratingDataA === 'object' ? ratingDataA.rating : ratingDataA;
          const rB = typeof ratingDataB === 'object' ? ratingDataB.rating : ratingDataB;
          return (order[rB] || 0) - (order[rA] || 0);
        case 'tmdb-desc':
          return (metaB?.tmdb_rating || 0) - (metaA?.tmdb_rating || 0);
        default: return dateB - dateA;
      }
    });
    
    console.log('Filtered results:', filtered.length, 'of', entries.length);
    return filtered.map(([id]) => id);
  };

  const filteredIds = getFilteredMovieIds();
  const totalCount = filteredIds.length;
  const totalPages = Math.ceil(totalCount / moviesPerPage);

  // Fetch display data for current page only
  useEffect(() => {
    const fetchPageMovies = async () => {
      if (filteredIds.length === 0) {
        setDisplayMovies([]);
        return;
      }

      setIsLoading(true);
      const startIdx = (currentPage - 1) * moviesPerPage;
      const pageIds = filteredIds.slice(startIdx, startIdx + moviesPerPage);
      
      const movies = await Promise.all(
        pageIds.map(async (movieId) => {
          const ratingData = watchedMovies[movieId];
          const meta = moviesDatabase?.[movieId];
          
          // Use cached metadata if complete, otherwise fetch
          if (meta?.title && meta?.genre_ids) {
            const rating = typeof ratingData === 'object' ? ratingData.rating : ratingData;
            const ratedAt = typeof ratingData === 'object' ? ratingData.ratedAt : Date.now();
            return {
              id: parseInt(movieId),
              title: meta.title,
              poster_path: null, // Will need to fetch for poster
              release_date: meta.releaseDate,
              vote_average: meta.tmdb_rating || 0,
              genre_ids: meta.genre_ids,
              original_language: meta.language,
              contentRating: meta.contentRating,
              media_type: meta.mediaType || 'movie',
              userRating: rating,
              ratedAt
            };
          }
          
          // Fallback: fetch from TMDB
          try {
            let type = meta?.mediaType || 'movie';
            let response = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}`);
            if (!response.ok && response.status === 404) {
              type = type === 'movie' ? 'tv' : 'movie';
              response = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}`);
            }
            const movieData = await response.json();
            if (movieData.success === false) return null;
            const rating = typeof ratingData === 'object' ? ratingData.rating : ratingData;
            const ratedAt = typeof ratingData === 'object' ? ratingData.ratedAt : Date.now();
            return { ...movieData, title: movieData.title || movieData.name, release_date: movieData.release_date || movieData.first_air_date, vote_average: movieData.vote_average || 0, genre_ids: movieData.genres?.map(g => g.id) || [], userRating: rating, ratedAt, contentRating: meta?.contentRating, media_type: type };
          } catch (error) {
            return null;
          }
        })
      );
      
      // Fetch posters for movies from cache (need poster_path)
      const moviesWithPosters = await Promise.all(
        movies.filter(m => m).map(async (movie) => {
          if (movie.poster_path === null) {
            try {
              const type = movie.media_type || 'movie';
              const response = await fetch(`https://api.themoviedb.org/3/${type}/${movie.id}?api_key=${TMDB_API_KEY}`);
              const data = await response.json();
              return { ...movie, poster_path: data.poster_path };
            } catch { return movie; }
          }
          return movie;
        })
      );
      
      setDisplayMovies(moviesWithPosters.filter(m => m));
      setIsLoading(false);
    };

    fetchPageMovies();
  }, [JSON.stringify(filteredIds), currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [effectiveSearchTerm, JSON.stringify(effectiveGenres), effectiveLanguage, effectiveRating, effectiveMinRating, JSON.stringify(effectiveYearRange), sortBy, mediaType]);

  const getRatingIcon = (rating) => {
    switch (rating) {
      case 'dislike': return '👎';
      case 'like': return '👍';
      case 'superlike': return '❤️';
      default: return '';
    }
  };

  if (showHistory) {
    return <RatingHistoryView onBack={() => setShowHistory(false)} />;
  }

  return (
    <div className="my-ratings">
      <div className="ratings-header">
        <h2>My Rated Movies ({totalCount === totalRatedCount ? totalCount : `${totalCount}/${totalRatedCount}`})</h2>
        <button 
          onClick={() => setShowHistory(true)}
          className="history-btn"
        >
          History
        </button>
      </div>
      
      <div className="ratings-controls">
        <input
          type="text"
          placeholder="Search your rated movies..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="search-input"
        />
        
        <select 
          value={sortBy} 
          onChange={(e) => setSortBy(e.target.value)}
          className="sort-select"
        >
          <option value="date">Latest Rated First</option>
          <option value="date-asc">Oldest Rated First</option>
          <option value="title-asc">Title (A-Z)</option>
          <option value="title-desc">Title (Z-A)</option>
          <option value="rating-desc">User Rating (♥ → 👍 → 👎)</option>
          <option value="tmdb-desc">Highest TMDB Rating</option>
        </select>
      </div>

      {totalCount === 0 && !isLoading ? (
        <p>No movies rated yet. Start rating movies to see them here!</p>
      ) : (
        <>
          {isLoading && (
            <div className="loading-status">Loading...</div>
          )}
          {!isLoading && displayMovies.length === 0 && totalCount > 0 && (
            <div className="no-results">
              <p>{effectiveSearchTerm ? `No results for "${effectiveSearchTerm}" in your rated movies.` : `No movies match your filters. Try adjusting your search criteria.`}</p>
            </div>
          )}
          <div className="movies-grid">
            {displayMovies.map(movie => (
              <MovieCard
                key={movie.id}
                movie={movie}
                isWatched={watchedMovies[movie.id]}
                isInWatchlist={false}
                isWatchedOnly={!!watchedMovies[movie.id]}
                onMarkWatched={onMarkWatched}
                onToggleWatchlist={null}
                onToggleWatched={onToggleWatched}
                getMovieDetails={getMovieDetails}
                selectedCountry={selectedCountry}
                onDirectorClick={(directorName) => { onNavigateSearch('director', directorName); }}
                onCastClick={(actorName) => { onNavigateSearch('cast', actorName); }}
                onGenreClick={(genreName) => { onNavigateSearch('genre', genreName); }}
                onLanguageClick={(languageCode) => { onNavigateSearch('language', languageCode); }}
                showRatingDate={true}
                onOpenModal={onOpenModal}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              
              <span className="page-info">
                Page {currentPage} of {totalPages} ({totalCount} movies)
              </span>
              
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WatchlistView({ watchlist, watchedMovies, onToggleWatchlist, onToggleWatched, onMarkWatched, getMovieDetails, globalSearchTerm, searchScope, selectedGenres, selectedLanguage, selectedRating, minRating, yearRange, moviesDatabase, onNavigateSearch, ratingHistory, selectedCountry, mediaType, defaultTab, onOpenModal }) {
  const [pageMovies, setPageMovies] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [activeTab, setActiveTab] = useState(defaultTab || 'shortlisted');
  
  // Sync activeTab when defaultTab changes (toggle switches)
  useEffect(() => {
    if (defaultTab) setActiveTab(defaultTab);
  }, [defaultTab]);
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const moviesPerPage = 25;

  // "Watched" tab shows all movies in watchedMovies (any rating)
  const watchedList = watchedMovies; // All watched movies (rated or just marked watched)
  console.log('WatchlistView - watchlist:', Object.keys(watchlist || {}).length, 'watched:', Object.keys(watchedList || {}).length);

  // Get current data source based on tab
  const currentData = activeTab === 'shortlisted' ? watchlist : watchedList;
  const totalCount = Object.keys(currentData).length;

  // Effective filters - only apply when scope checkbox is checked
  const scopeActive = activeTab === 'shortlisted' ? searchScope?.watchlistedOnly : searchScope?.watchedOnly;
  const effectiveSearchTerm = globalSearchTerm || searchTerm;
  const effectiveGenres = scopeActive ? selectedGenres : [];
  const effectiveLanguage = scopeActive ? selectedLanguage : '';
  const effectiveRating = scopeActive ? selectedRating : '';
  const effectiveMinRating = scopeActive ? minRating : 0;
  const effectiveYearRange = scopeActive ? yearRange : null;

  // Filter movie IDs using moviesDatabase (no API calls)
  const getFilteredMovieIds = () => {
    const entries = Object.entries(currentData);
    
    const filtered = entries.filter(([movieId]) => {
      const metadata = moviesDatabase?.[movieId];
      
      // Media type filter — default to 'movie' if no metadata
      if (mediaType !== 'all') {
        const itemType = metadata?.mediaType || 'movie';
        if (itemType !== mediaType) return false;
      }
      
      if (!metadata) return !effectiveSearchTerm?.trim(); // Exclude from search results if no metadata to match against

      // Text search
      if (effectiveSearchTerm?.trim()) {
        const term = effectiveSearchTerm.toLowerCase();
        const matchesTitle = metadata.title?.toLowerCase().includes(term);
        const matchesCast = metadata.cast?.some(c => c.toLowerCase().includes(term));
        const matchesDirector = metadata.directors?.some(d => d.toLowerCase().includes(term));
        if (!matchesTitle && !matchesCast && !matchesDirector) return false;
      }

      // Genre filter
      if (effectiveGenres?.length > 0) {
        if (!metadata.genre_ids?.some(id => effectiveGenres.includes(id))) return false;
      }

      // Language filter
      if (effectiveLanguage && effectiveLanguage !== 'all' && effectiveLanguage !== '') {
        if (metadata.language !== effectiveLanguage) return false;
      }

      // Content rating filter
      if (effectiveRating && effectiveRating !== '') {
        if (metadata.contentRating !== effectiveRating) return false;
      }

      // Min rating filter
      if (effectiveMinRating && effectiveMinRating > 0) {
        if (!metadata.tmdb_rating || metadata.tmdb_rating < effectiveMinRating) return false;
      }

      // Year range filter
      if (effectiveYearRange?.min || effectiveYearRange?.max) {
        const year = metadata.year;
        if (year) {
          if (effectiveYearRange.min && year < effectiveYearRange.min) return false;
          if (effectiveYearRange.max && year > effectiveYearRange.max) return false;
        }
      }

      return true;
    });

    return filtered.map(([id]) => id);
  };

  // Sort filtered IDs
  const getSortedMovieIds = () => {
    const filteredIds = getFilteredMovieIds();
    
    return filteredIds.sort((a, b) => {
      const dataA = currentData[a];
      const dataB = currentData[b];
      const metaA = moviesDatabase?.[a];
      const metaB = moviesDatabase?.[b];

      switch (sortBy) {
        case 'title-asc':
          return (metaA?.title || '').localeCompare(metaB?.title || '');
        case 'title-desc':
          return (metaB?.title || '').localeCompare(metaA?.title || '');
        case 'rating-desc':
          return (metaB?.tmdb_rating || 0) - (metaA?.tmdb_rating || 0);
        case 'user-rating':
          const uOrder = { 'superlike': 3, 'like': 2, 'dislike': 1, 'watched': 0 };
          const urA = watchedMovies?.[a]?.rating || '';
          const urB = watchedMovies?.[b]?.rating || '';
          return (uOrder[urB] || -1) - (uOrder[urA] || -1);
        case 'date-asc':
          const dateA = activeTab === 'shortlisted' ? dataA?.addedAt : (dataA?.ratedAt || dataA?.watchedAt);
          const dateB = activeTab === 'shortlisted' ? dataB?.addedAt : (dataB?.ratedAt || dataB?.watchedAt);
          return new Date(dateA || 0) - new Date(dateB || 0);
        case 'date':
        default:
          const dateA2 = activeTab === 'shortlisted' ? dataA?.addedAt : (dataA?.ratedAt || dataA?.watchedAt);
          const dateB2 = activeTab === 'shortlisted' ? dataB?.addedAt : (dataB?.ratedAt || dataB?.watchedAt);
          return new Date(dateB2 || 0) - new Date(dateA2 || 0);
      }
    });
  };

  const sortedIds = getSortedMovieIds();
  const filteredCount = sortedIds.length;
  const totalPages = Math.ceil(filteredCount / moviesPerPage);

  // Fetch only current page's movies
  const fetchPageMovies = async () => {
    const startIndex = (currentPage - 1) * moviesPerPage;
    const pageIds = sortedIds.slice(startIndex, startIndex + moviesPerPage);
    
    if (pageIds.length === 0) {
      setPageMovies([]);
      return;
    }

    setIsLoading(true);
    const movies = await Promise.all(
      pageIds.map(async (movieId) => {
        try {
          const meta = moviesDatabase?.[movieId];
          let type = meta?.mediaType || 'movie';
          let response = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}`);
          // If 404, try the other type
          if (!response.ok && response.status === 404) {
            type = type === 'movie' ? 'tv' : 'movie';
            response = await fetch(`https://api.themoviedb.org/3/${type}/${movieId}?api_key=${TMDB_API_KEY}`);
          }
          const movieData = await response.json();
          if (movieData.success === false) return null;
          const listData = currentData[movieId];
          return {
            ...movieData,
            title: movieData.title || movieData.name,
            release_date: movieData.release_date || movieData.first_air_date,
            vote_average: movieData.vote_average || 0,
            media_type: type,
            listDate: activeTab === 'shortlisted' ? listData?.addedAt : listData?.watchedAt
          };
        } catch (error) {
          console.error('Error fetching movie:', movieId, error);
          return null;
        }
      })
    );
    
    setPageMovies(movies.filter(m => m !== null));
    setIsLoading(false);
  };

  // Fetch when page, sort, filters, or tab changes
  useEffect(() => {
    fetchPageMovies();
  }, [currentPage, sortBy, activeTab, effectiveSearchTerm, JSON.stringify(effectiveGenres), effectiveLanguage, effectiveRating, effectiveMinRating, JSON.stringify(effectiveYearRange), JSON.stringify(currentData), mediaType]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [effectiveSearchTerm, JSON.stringify(effectiveGenres), effectiveLanguage, effectiveRating, effectiveMinRating, JSON.stringify(effectiveYearRange), activeTab, mediaType]);

  // Determine header text
  const isFiltered = effectiveSearchTerm?.trim() || effectiveGenres?.length > 0 || 
    (effectiveLanguage && effectiveLanguage !== 'all' && effectiveLanguage !== '') ||
    effectiveRating || (effectiveMinRating && effectiveMinRating > 0) ||
    effectiveYearRange?.min || effectiveYearRange?.max;
  const headerCount = isFiltered ? `(${filteredCount}/${totalCount})` : `(${totalCount})`;

  if (showHistory) {
    return <RatingHistoryView onBack={() => setShowHistory(false)} />;
  }

  return (
    <div className="watchlist-view">
      <div className="ratings-header">
        <h2>My Lists</h2>
        <button onClick={() => setShowHistory(true)} className="history-btn">History</button>
      </div>
      
      {/* Tabs */}
      <div className="watchlist-tabs">
        <button 
          className={`tab-button ${activeTab === 'shortlisted' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('shortlisted');
            setCurrentPage(1);
            setSearchTerm('');
          }}
        >
          Watchlist {activeTab === 'shortlisted' ? headerCount : `(${Object.keys(watchlist).length})`}
        </button>
        <button 
          className={`tab-button ${activeTab === 'watched' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('watched');
            setCurrentPage(1);
            setSearchTerm('');
          }}
        >
          Watched {activeTab === 'watched' ? headerCount : `(${Object.keys(watchedList).length})`}
        </button>
      </div>

      {/* Search and Sort */}
      <div className="ratings-controls">
          <input
            type="text"
            placeholder={`Search in ${activeTab === 'shortlisted' ? 'watchlist' : 'watched'}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-select">
          <option value="date">Latest Added First</option>
          <option value="date-asc">Oldest Added First</option>
          <option value="title-asc">Title (A-Z)</option>
          <option value="title-desc">Title (Z-A)</option>
          <option value="rating-desc">Highest TMDB Rating</option>
          <option value="user-rating">User Rating (♥ → 👍 → 👎)</option>
        </select>
      </div>

      {isLoading && <div className="loading-status">Loading...</div>}

      {/* Movies Grid */}
      <div className="movies-grid">
        {pageMovies.map(movie => (
          <MovieCard
            key={movie.id}
            movie={movie}
            onToggleWatchlist={onToggleWatchlist}
            onToggleWatched={onToggleWatched}
            onMarkWatched={onMarkWatched}
            isWatched={watchedMovies[movie.id]}
            isInWatchlist={!!watchlist[movie.id]}
            isWatchedOnly={!!watchedList[movie.id]}
            getMovieDetails={getMovieDetails}
            selectedCountry={selectedCountry}
            onDirectorClick={(directorName) => { onNavigateSearch('director', directorName); }}
            onCastClick={(actorName) => { onNavigateSearch('cast', actorName); }}
            onGenreClick={(genreName) => { onNavigateSearch('genre', genreName); }}
            onLanguageClick={(languageCode) => { onNavigateSearch('language', languageCode); }}
            showWatchlistDate={activeTab === 'shortlisted'}
            onOpenModal={onOpenModal}
          />
        ))}
      </div>

      {pageMovies.length === 0 && !isLoading && (
        <div className="no-results">
          <p>{globalSearchTerm ? `No results for "${globalSearchTerm}" in your ${activeTab === 'shortlisted' ? 'watchlist' : 'watched'} movies.` : `No movies in this list yet.`}</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>First</button>
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</button>
          <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Last</button>
        </div>
      )}
    </div>
  );
}

function RatingHistoryView({ onBack }) {
  const [history, setHistory] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 200;

  useEffect(() => {
    const ratingHistory = JSON.parse(localStorage.getItem('ratingHistory') || '[]');
    setHistory(ratingHistory);
  }, []);

  const totalPages = Math.ceil(history.length / entriesPerPage);
  const startIndex = (currentPage - 1) * entriesPerPage;
  const currentEntries = history.slice(startIndex, startIndex + entriesPerPage);

  return (
    <div className="rating-history">
      <div className="history-header">
        <h2>Rating History ({history.length} entries)</h2>
        <button onClick={onBack} className="back-btn">
          Back to Ratings
        </button>
      </div>

      {history.length === 0 ? (
        <p>No rating history yet. Start rating movies to see activity here!</p>
      ) : (
        <>
          <div className="history-list">
            {currentEntries.map((entry, index) => (
              <div key={startIndex + index} className="history-entry">
                {entry}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              
              <span className="page-info">
                Page {currentPage} of {totalPages} ({entriesPerPage} per page)
              </span>
              
              <button 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// MyContentView — personalized recommendations grid
// ============================================================================
function MyContentView({
  watchedMovies,
  watchlist,
  moviesDatabase,
  getMovieDetails,
  onMarkWatched,
  onToggleWatchlist,
  onToggleWatched,
  selectedCountry,
  mediaType,
  onNavigateSearch,
  tmdbApiKey,
  onOpenModal,
}) {
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // start true so we render "…finding" instead of empty
  const [hideWatchlisted, setHideWatchlisted] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState({ queriesRun: 0, totalCandidates: 0, fallbackUsed: false });
  // Cycles 1→2→3→4→5→1… on Refresh. TMDB Discover is deterministic per page,
  // so paging is how we surface new content instead of the same items again.
  const [refreshCount, setRefreshCount] = useState(0);

  // Profile is a synchronous derivation of watchedMovies + moviesDatabase.
  // Using useMemo (not useState + useEffect) eliminates the "empty state flash"
  // that happened during the first render before useEffect fired.
  const profile = useMemo(
    () => computeTasteProfile(watchedMovies, moviesDatabase),
    [watchedMovies, moviesDatabase],
  );

  // Composite keys account for the fact that TMDB Movie IDs and TV IDs live in
  // separate namespaces. Without this, rating Movie 550 would hide TV 550 too.
  // We look up mediaType from moviesDatabase (falls back to 'movie' when unknown).
  const watchedKeys = useMemo(() => {
    const s = new Set();
    Object.keys(watchedMovies || {}).forEach((id) => {
      const mt = moviesDatabase?.[id]?.mediaType || 'movie';
      s.add(`${mt}-${id}`);
      // Fallback: also add both media types so an untyped rating still filters both
      // (rare — only for entries with no moviesDatabase record)
      if (!moviesDatabase?.[id]?.mediaType) {
        s.add(`movie-${id}`);
        s.add(`tv-${id}`);
      }
    });
    return s;
  }, [watchedMovies, moviesDatabase]);

  const watchlistKeys = useMemo(() => {
    const s = new Set();
    Object.keys(watchlist || {}).forEach((id) => {
      const mt = moviesDatabase?.[id]?.mediaType || 'movie';
      s.add(`${mt}-${id}`);
      if (!moviesDatabase?.[id]?.mediaType) {
        s.add(`movie-${id}`);
        s.add(`tv-${id}`);
      }
    });
    return s;
  }, [watchlist, moviesDatabase]);

  // Single fetcher used by both the auto-run effect and the manual Refresh
  // button. Wrapped in useCallback so deps are explicit and the effect below
  // stays honest about what it depends on.
  const runFetch = useCallback(async (signal) => {
    if (!profile || profile.totalRatedCount === 0) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    // Cycle pages 1..5 so each Refresh surfaces fresh items
    const page = (refreshCount % 5) + 1;
    try {
      const result = await fetchRecommendations(profile, tmdbApiKey, {
        watchedKeys,              // media-type-aware
        watchlistKeys,
        hideWatchlisted: false,   // filtered client-side; fetch the superset
        target: 24,
        mediaTypeFilter: mediaType || 'all',
        signal,
        page,
      });
      if (signal?.aborted) return;
      setRecommendations(result.items || []);
      setMeta({
        queriesRun: result.queriesRun,
        totalCandidates: result.totalCandidates,
        fallbackUsed: !!result.fallbackUsed,
        page,
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setError(e.message || 'Failed to fetch recommendations');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [profile, watchedKeys, watchlistKeys, mediaType, tmdbApiKey, refreshCount]);

  // Auto-fetch whenever the profile, media-type filter, or refresh counter changes.
  // hideWatchlisted is intentionally excluded — it's a client-side filter (see below).
  useEffect(() => {
    const controller = new AbortController();
    runFetch(controller.signal);
    return () => controller.abort();
  }, [runFetch]);

  // Reset the page cycle when the taste profile fundamentally changes
  // (e.g., user switches media-type filter). Prevents page 5 → 0 items scenarios.
  useEffect(() => { setRefreshCount(0); }, [mediaType]);

  const handleRefresh = () => setRefreshCount((n) => n + 1);

  // Empty state — user genuinely has no ratings at all.
  // Suppressed while we're still loading (first paint) to avoid a flash of
  // the "Build your taste" copy before recommendations arrive.
  if (!profile || profile.totalRatedCount === 0) {
    if (isLoading) {
      return (
        <div className="my-content-view">
          <div className="my-content-empty">
            <p className="my-content-empty-copy">Loading your taste profile…</p>
          </div>
        </div>
      );
    }
    // Detect the "user is not signed in" case vs "signed in but no ratings"
    const hasAnyWatched = Object.keys(watchedMovies || {}).length > 0;
    return (
      <div className="my-content-view">
        <div className="my-content-empty">
          <h2 className="my-content-empty-title">Build your taste</h2>
          <p className="my-content-empty-copy">
            {hasAnyWatched
              ? `You've rated ${Object.keys(watchedMovies).length} items, but their details haven't loaded yet. Try refreshing the page, or open a movie/show to re-cache its metadata.`
              : 'Rate at least a few movies and shows with 👍 or 👎 (or ❤️ for superlike) on the Home page, and we\'ll show you personalized recommendations here based on what you like.'}
          </p>
        </div>
      </div>
    );
  }

  const summary = formatProfileSummary(profile);
  // "% liked" = thumbs-up rate over items with any thumbs verdict (excludes plain 'watched')
  const verdictCount = profile.positiveCount + profile.negativeCount;
  const positiveRatioPct = verdictCount > 0
    ? Math.round((profile.positiveCount / verdictCount) * 100)
    : 0;

  // Client-side watchlist filter — toggling this does NOT re-fetch TMDB
  const displayedRecommendations = hideWatchlisted
    ? recommendations.filter((m) => !watchlistKeys.has(`${m.media_type}-${m.id}`))
    : recommendations;

  const topDirectorNames = profile.topDirectors.slice(0, 3).map(([n]) => n);
  const topCastNames = profile.topCast.slice(0, 4).map(([n]) => n);

  return (
    <div className="my-content-view">
      {/* Profile summary card */}
      <div className="my-content-profile">
        <div className="my-content-profile-header">
          <h2 className="my-content-hero">Made for <em>you</em></h2>
          <p className="my-content-tagline">{summary}</p>
        </div>

        <div className="my-content-stats">
          <div className="my-content-stat">
            <span className="my-content-stat-num">{profile.totalRatedCount}</span>
            <span className="my-content-stat-label">rated</span>
          </div>
          <div className="my-content-stat">
            <span className="my-content-stat-num">{positiveRatioPct}%</span>
            <span className="my-content-stat-label">liked</span>
          </div>
          {profile.yearMean && (
            <div className="my-content-stat">
              <span className="my-content-stat-num">{Math.round(profile.yearMean)}</span>
              <span className="my-content-stat-label">avg year</span>
            </div>
          )}
        </div>

        {(topDirectorNames.length > 0 || topCastNames.length > 0) && (
          <div className="my-content-people">
            {topDirectorNames.length > 0 && (
              <div className="my-content-people-row">
                <span className="my-content-people-label">Directors you love:</span>
                <span className="my-content-people-list">
                  {topDirectorNames.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button
                        className="my-content-people-chip"
                        onClick={() => onNavigateSearch && onNavigateSearch('director', n)}
                        aria-label={`Search movies directed by ${n}`}
                        title={`Search movies by ${n}`}
                      >{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {topCastNames.length > 0 && (
              <div className="my-content-people-row">
                <span className="my-content-people-label">Cast you love:</span>
                <span className="my-content-people-list">
                  {topCastNames.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ', '}
                      <button
                        className="my-content-people-chip"
                        onClick={() => onNavigateSearch && onNavigateSearch('cast', n)}
                        aria-label={`Search movies starring ${n}`}
                        title={`Search movies with ${n}`}
                      >{n}</button>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="my-content-controls">
        <div className="my-content-controls-left">
          <h3 className="tf-results-count">
            {isLoading ? 'Finding your matches…' : `${displayedRecommendations.length} recommendations`}
          </h3>
          <span className="my-content-meta">
            {meta.fallbackUsed
              ? 'Showing trending — rate more items for taste-matched picks'
              : (meta.totalCandidates > 0
                  ? `Screened ${meta.totalCandidates} candidates${meta.page > 1 ? ` · page ${meta.page}/5` : ''}`
                  : '')}
          </span>
        </div>
        <div className="my-content-controls-right">
          <label className="my-content-toggle">
            <input
              type="checkbox"
              checked={hideWatchlisted}
              onChange={(e) => setHideWatchlisted(e.target.checked)}
            />
            <span>Hide watchlisted</span>
          </label>
          <button
            className="my-content-refresh"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh recommendations"
            aria-busy={isLoading}
            title="Refresh recommendations"
          >
            {isLoading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="my-content-error">Error: {error}</div>}

      {/* Grid */}
      {displayedRecommendations.length > 0 ? (
        <div className="movies-grid">
          {displayedRecommendations.map((movie) => (
            <MovieCard
              key={`${movie.media_type}-${movie.id}`}
              movie={{
                ...movie,
                title: movie.title || movie.name,
                release_date: movie.release_date || movie.first_air_date,
              }}
              isWatched={!!watchedMovies[movie.id]}
              isInWatchlist={!!watchlist[movie.id]}
              isWatchedOnly={watchedMovies[movie.id]?.rating === 'watched'}
              onMarkWatched={onMarkWatched}
              onToggleWatchlist={onToggleWatchlist}
              onToggleWatched={onToggleWatched}
              getMovieDetails={getMovieDetails}
              onDirectorClick={(name) => onNavigateSearch && onNavigateSearch('director', name)}
              onCastClick={(name) => onNavigateSearch && onNavigateSearch('cast', name)}
              onGenreClick={() => {}}
              onLanguageClick={() => {}}
              selectedCountry={selectedCountry}
              onOpenModal={onOpenModal}
            />
          ))}
        </div>
      ) : (!isLoading && (
        <div className="my-content-empty">
          <p className="my-content-empty-copy">
            No new recommendations right now. Try refreshing, or rate more content to expand your profile.
          </p>
        </div>
      ))}
    </div>
  );
}

export default App;
