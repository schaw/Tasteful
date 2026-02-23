import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { syncUserData, getUserData, migrateLocalStorageToFirebase, removeFromCollection } from './dataSync';
import AuthComponent from './AuthComponent';
import './App.css';

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
  const [showFilters, setShowFilters] = useState(true);
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

  // Authentication state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

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
          // Sync merged data and clear old watchedList
          await syncUserData(user.uid, { watchedMovies: mergedWatchedMovies, watchedList: {} });
          console.log('Migrated watchedList into watchedMovies');
        }
        
        setWatchedMovies(mergedWatchedMovies);
        setWatchlist(userData.watchlist || {});
        setRatingHistory(userData.ratingHistory || []);
        setMoviesDatabase(userData.moviesDatabase || {});
        setUserInteractions(userData.userInteractions || []);
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
        } catch (error) {
          console.error('Error loading from localStorage:', error);
          setWatchedMovies({});
          setWatchlist({});
          setRatingHistory([]);
          setMoviesDatabase({});
          setUserInteractions([]);
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

  // Persist data changes
  useEffect(() => {
    try {
      localStorage.setItem('watchedMovies', JSON.stringify(watchedMovies));
    } catch (error) {
      console.error('Error saving watched movies:', error);
    }
  }, [watchedMovies]);

  useEffect(() => {
    try {
      localStorage.setItem('watchlist', JSON.stringify(watchlist));
    } catch (error) {
      console.error('Error saving watchlist:', error);
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem('moviesDatabase', JSON.stringify(moviesDatabase));
    } catch (error) {
      console.error('Error saving movies database:', error);
    }
  }, [moviesDatabase]);

  useEffect(() => {
    try {
      localStorage.setItem('userInteractions', JSON.stringify(userInteractions));
    } catch (error) {
      console.error('Error saving user interactions:', error);
    }
  }, [userInteractions]);

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
        directors: creditsData.crew?.filter(person => person.job === 'Director').map(director => director.name) || [],
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
      await storeMovieInteraction(movieId, 'rated', userRatingValue, false);
    }
    
    setWatchedMovies(updated);
    
    const updatedHistory = [historyEntry, ...ratingHistory];
    setRatingHistory(updatedHistory);
    
    if (user) {
      try {
        await syncUserData(user.uid, {
          watchedMovies: updated,
          watchlist: updatedWatchlist,
          ratingHistory: updatedHistory,
          moviesDatabase,
          userInteractions
        });
      } catch (error) {
        console.error('Failed to sync rating data:', error);
      }
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
      
      // Store comprehensive movie interaction data when adding to watchlist
      await storeMovieInteraction(movieId, 'watchlisted', null, false);
    }
    setWatchlist(updated);
    
    // Sync with Firebase if user is logged in
    if (user) {
      try {
        if (!isAdding) {
          // Explicitly delete the key from Firebase
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
                {user ? (
                  <button onClick={() => signOut(auth)} className="auth-btn">Sign Out</button>
                ) : (
                  <button onClick={() => setShowAuth(true)} className="auth-btn">Sign In</button>
                )}
              </div>
            </nav>
          </header>

          <main>
            {/* Global Search Panel - Available on all pages */}
            <div className="filters">
              <div className="search-section">
                <div className="search-container">
                  <div className="input-group">
                    <div className="input-group-btn">
                      <select 
                        value={searchCategory} 
                        onChange={(e) => setSearchCategory(e.target.value)}
                        className="search-category"
                      >
                        <option value="Content">Content</option>
                        <option value="Cast">Cast</option>
                        <option value="Director">Director</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      placeholder={`Search ${searchCategory === 'Content' ? 'movies & shows' : searchCategory.toLowerCase() + 's'}...`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && performSearch()}
                      className="search-input"
                    />
                    <button className="search-btn" onClick={performSearch}>🔍</button>
                  </div>
                  <div className="media-type-row">
                    <button 
                      className={`media-seg-btn ${mediaType === 'all' ? 'active' : ''}`}
                      onClick={() => { setMediaType('all'); setSelectedGenres([]); }}
                    >All</button>
                    <button 
                      className={`media-seg-btn ${mediaType === 'movie' ? 'active' : ''}`}
                      onClick={() => { setMediaType('movie'); setSelectedGenres([]); }}
                    >Movies</button>
                    <button 
                      className={`media-seg-btn ${mediaType === 'tv' ? 'active' : ''}`}
                      onClick={() => { setMediaType('tv'); setSelectedGenres([]); }}
                    >Shows</button>
                  </div>
                </div>
                
                {/* Search Scope Toggle Switches - Visible on all pages */}
                <div className="search-scope">
                  <div className="toggle-wrap">
                    <input type="checkbox" id="toggle-rated" checked={searchScope.ratedOnly}
                      onChange={() => {
                        const newVal = !searchScope.ratedOnly;
                        if (newVal) {
                          setSearchScope({ratedOnly: true, watchlistedOnly: false, watchedOnly: false});
                          setCurrentView('ratings');
                        } else {
                          setSearchScope({ratedOnly: false, watchlistedOnly: false, watchedOnly: false});
                          setCurrentView('home');
                        }
                      }} />
                    <label htmlFor="toggle-rated" className="toggle-switch"></label>
                    <label htmlFor="toggle-rated" className="toggle-label">Rated</label>
                  </div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="toggle-watchlisted" checked={searchScope.watchlistedOnly}
                      onChange={() => {
                        const newVal = !searchScope.watchlistedOnly;
                        const newScope = {ratedOnly: false, watchlistedOnly: newVal, watchedOnly: searchScope.watchedOnly};
                        setSearchScope(newScope);
                        if (!newVal && !newScope.watchedOnly) setCurrentView('home');
                        else if (newVal && !newScope.watchedOnly) setCurrentView('watchlist');
                      }} />
                    <label htmlFor="toggle-watchlisted" className="toggle-switch"></label>
                    <label htmlFor="toggle-watchlisted" className="toggle-label">Watchlisted</label>
                  </div>
                  <div className="toggle-wrap">
                    <input type="checkbox" id="toggle-watched" checked={searchScope.watchedOnly}
                      onChange={() => {
                        const newVal = !searchScope.watchedOnly;
                        const newScope = {ratedOnly: false, watchlistedOnly: searchScope.watchlistedOnly, watchedOnly: newVal};
                        setSearchScope(newScope);
                        if (!newVal && !newScope.watchlistedOnly) setCurrentView('home');
                        else if (newVal && !newScope.watchlistedOnly) setCurrentView('watchlist');
                      }} />
                    <label htmlFor="toggle-watched" className="toggle-switch"></label>
                    <label htmlFor="toggle-watched" className="toggle-label">Watched</label>
                  </div>
                </div>
              </div>

                {/* Filter Toggle Button - Mobile Only */}
                <button className="filter-toggle-btn" onClick={() => setShowFilters(!showFilters)}>
                  <span>{showFilters ? '▲' : '▼'}</span> Filters
                </button>

                {/* Collapsible Filters Section */}
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
                <div className="sort-section">
                  <label htmlFor="sort-select"><strong>Sort by:</strong></label>
                  <select 
                    id="sort-select"
                    value={sortBy} 
                    onChange={(e) => setSortBy(e.target.value)}
                    className="sort-select"
                    disabled={isSorting}
                  >
                    <option value="popularity">Popularity</option>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="year-desc">Newest Movies First</option>
                    <option value="year-asc">Oldest Movies First</option>
                    <option value="rating-desc">Highest Rating</option>
                    <option value="rotten-tomatoes">Rotten Tomatoes</option>
                    <option value="runtime-desc">Longest Runtime</option>
                    <option value="runtime-asc">Shortest Runtime</option>
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
                (isSorting ? movies : sortedMovies).map(movie => (
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

function MovieCard({ movie, isWatched, isInWatchlist, isWatchedOnly, onMarkWatched, onToggleWatchlist, onToggleWatched, getMovieDetails, onDirectorClick, onCastClick, onGenreClick, onLanguageClick, showRatingDate, showWatchlistDate, watchlistDate, selectedCountry }) {
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
      <div className={`poster-container ${showDetails ? 'flipped' : ''}`}>
        <div className="poster-flip-inner">
          {/* Front of card - Movie poster */}
          <div className="poster-front">
            <img
              src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
              alt={movie.title}
              onClick={loadDetails}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm1-16v2h-20v-2h5.711c.9 0 1.631-1.099 1.631-2h5.315c0 .901.73 2 1.631 2h5.712z"/>
                  </svg>
                ) : isInWatchlist ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    <line x1="12" y1="8" x2="12" y2="14"/>
                    <line x1="9" y1="11" x2="15" y2="11"/>
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
          <div className="poster-back" onClick={loadDetails}>
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
      <h3 onClick={loadDetails} className="movie-title">
        {movie.media_type === 'tv' && <span className="media-badge tv-badge">TV</span>}
        {movie.title} [{movie.release_date?.split('-')[0] || 'N/A'}]
      </h3>
      
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
          >
            ❤️
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

function MyRatingsView({ watchedMovies, onMarkWatched, onToggleWatched, getMovieDetails, globalSearchTerm, searchScope, selectedGenres, selectedLanguage, selectedRating, minRating, yearRange, moviesDatabase, onNavigateSearch, selectedCountry, mediaType }) {
  const [displayMovies, setDisplayMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('date');
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const moviesPerPage = 25;

  // Use global search/filters when scope is enabled, otherwise use local
  const effectiveSearchTerm = searchScope?.ratedOnly ? globalSearchTerm : searchTerm;
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
          value={searchScope?.ratedOnly ? globalSearchTerm : searchTerm}
          onChange={(e) => {
            if (!searchScope?.ratedOnly) {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }
          }}
          disabled={searchScope?.ratedOnly}
          className={`search-input ${searchScope?.ratedOnly ? 'search-disabled' : ''}`}
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
            <p>No movies match your filters. Try adjusting your search criteria.</p>
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

function WatchlistView({ watchlist, watchedMovies, onToggleWatchlist, onToggleWatched, onMarkWatched, getMovieDetails, globalSearchTerm, searchScope, selectedGenres, selectedLanguage, selectedRating, minRating, yearRange, moviesDatabase, onNavigateSearch, ratingHistory, selectedCountry, mediaType, defaultTab }) {
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
  const effectiveSearchTerm = scopeActive ? globalSearchTerm : searchTerm;
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
      
      if (!metadata) return true; // Include if no metadata for other filters

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
        {!scopeActive && (
          <input
            type="text"
            placeholder="Search in list..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        )}
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
          />
        ))}
      </div>

      {pageMovies.length === 0 && !isLoading && (
        <p className="no-movies">No movies in this list yet.</p>
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

export default App;
