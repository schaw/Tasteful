import React, { useState, useEffect } from 'react';
import './App.css';

const TMDB_API_KEY = process.env.REACT_APP_TMDB_API_KEY || '692135011495791f35e255a0b941a6e9';
const OMDB_API_KEY = process.env.REACT_APP_OMDB_API_KEY || '9b24abc';

function App() {
  const [movies, setMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchCategory, setSearchCategory] = useState('Movie');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const currentYear = new Date().getFullYear();
  const [yearRange, setYearRange] = useState({ min: currentYear - 15, max: currentYear });
  const [selectedRating, setSelectedRating] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [language, setLanguage] = useState('');
  const [currentView, setCurrentView] = useState('home');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [showMoreButton, setShowMoreButton] = useState(false);
  const [genresPerTwoRows, setGenresPerTwoRows] = useState(12);
  const [directorSearch, setDirectorSearch] = useState(null);
  const [castSearch, setCastSearch] = useState(null);
  const [genreSearch, setGenreSearch] = useState(null);
  const [languageSearch, setLanguageSearch] = useState(null);
  const [watchedMovies, setWatchedMovies] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('watchedMovies') || '{}');
    } catch (error) {
      console.error('Error loading watched movies:', error);
      return {};
    }
  });
  const [watchlist, setWatchlist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('watchlist') || '[]');
    } catch (error) {
      console.error('Error loading watchlist:', error);
      return [];
    }
  });

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

  // Trigger search when genre/language context changes
  useEffect(() => {
    if (genreSearch || languageSearch) {
      searchMovies(1);
    }
  }, [genreSearch, languageSearch]);

  // Refresh recommendations when watchedMovies changes (after rating)
  useEffect(() => {
    if (currentView === 'home' && movies.length > 0) {
      // If less than 5 movies remaining, refresh to get more
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      const unratedMovies = movies.filter(movie => !ratedMovieIds.includes(movie.id));
      
      if (unratedMovies.length < 5) {
        searchMovies();
      }
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
      // Search for directors with fuzzy matching
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(directorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        console.log('Director not found');
        setMovies([]);
        return;
      }
      
      // Use fuzzy matching to find best director match
      const director = findBestPersonMatch(directorName, personData.results);
      const directorId = director.id;
      
      console.log(`Searching for director: "${directorName}" -> Found: "${director.name}"`);
      
      // Get the director's movie credits
      const creditsResponse = await fetch(`https://api.themoviedb.org/3/person/${directorId}/movie_credits?api_key=${TMDB_API_KEY}`);
      const creditsData = await creditsResponse.json();
      
      // Filter for movies where they were director
      let directorMovies = creditsData.crew?.filter(movie => movie.job === 'Director') || [];
      
      // Apply filters
      if (selectedGenres.length > 0) {
        directorMovies = directorMovies.filter(movie => 
          movie.genre_ids?.some(genreId => selectedGenres.includes(genreId))
        );
      }
      
      if (yearRange.min || yearRange.max) {
        directorMovies = directorMovies.filter(movie => {
          const year = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0;
          return year >= yearRange.min && year <= yearRange.max;
        });
      }
      
      if (minRating > 0) {
        directorMovies = directorMovies.filter(movie => movie.vote_average >= minRating);
      }
      
      // Filter out already rated movies
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      directorMovies = directorMovies.filter(movie => !ratedMovieIds.includes(movie.id));
      
      // Sort by popularity
      directorMovies.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      
      setMovies(directorMovies);
      setDirectorSearch(director.name); // Use the actual found name
      setCastSearch(null);
    } catch (error) {
      console.error('Error fetching director movies:', error);
    }
  };

  const searchMoviesByCast = async (actorName) => {
    try {
      // Search for actors with fuzzy matching
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(actorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        console.log('Actor not found');
        setMovies([]);
        return;
      }
      
      // Use fuzzy matching to find best actor match
      const actor = findBestPersonMatch(actorName, personData.results);
      const actorId = actor.id;
      
      console.log(`Searching for actor: "${actorName}" -> Found: "${actor.name}"`);
      
      // Get the actor's movie credits
      const creditsResponse = await fetch(`https://api.themoviedb.org/3/person/${actorId}/movie_credits?api_key=${TMDB_API_KEY}`);
      const creditsData = await creditsResponse.json();
      
      // Get movies where they were cast
      let actorMovies = creditsData.cast || [];
      
      // Apply filters
      if (selectedGenres.length > 0) {
        actorMovies = actorMovies.filter(movie => 
          movie.genre_ids?.some(genreId => selectedGenres.includes(genreId))
        );
      }
      
      if (yearRange.min || yearRange.max) {
        actorMovies = actorMovies.filter(movie => {
          const year = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : 0;
          return year >= yearRange.min && year <= yearRange.max;
        });
      }
      
      if (minRating > 0) {
        actorMovies = actorMovies.filter(movie => movie.vote_average >= minRating);
      }
      
      // Filter out already rated movies
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      actorMovies = actorMovies.filter(movie => !ratedMovieIds.includes(movie.id));
      
      // Sort by popularity
      actorMovies.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      
      setMovies(actorMovies);
      setCastSearch(actor.name); // Use the actual found name
      setDirectorSearch(null);
    } catch (error) {
      console.error('Error fetching cast movies:', error);
    }
  };

  const searchMoviesByGenre = async (genreName) => {
    const genre = allGenres.find(g => g.name.toLowerCase() === genreName.toLowerCase());
    if (genre) {
      setSelectedGenres([genre.id]);
      setYearRange({ min: 1980, max: currentYear });
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
    
    setYearRange({ min: 1980, max: currentYear });
    setLanguageSearch(getLanguageName(languageCode));
  };

  const clearPersonSearch = () => {
    setDirectorSearch(null);
    setCastSearch(null);
    setGenreSearch(null);
    setLanguageSearch(null);
    searchMovies();
  };

  const performSearch = () => {
    if (searchCategory === 'Director') {
      searchMoviesByDirector(searchTerm);
    } else if (searchCategory === 'Cast') {
      searchMoviesByCast(searchTerm);
    } else {
      // For movie search, clear contexts and use unified search
      setGenreSearch(null);
      setLanguageSearch(null);
      searchMovies(1);
    }
  };

  const searchMovies = async (page = 1, accumulatedResults = []) => {
    try {
      const genreQuery = selectedGenres.length ? `&with_genres=${selectedGenres.join(',')}` : '';
      const yearQuery = `&primary_release_date.gte=${yearRange.min}-01-01&primary_release_date.lte=${yearRange.max}-12-31`;
      const ratingQuery = selectedRating ? `&certification_country=US&certification=${selectedRating}` : '';
      const minRatingQuery = minRating > 0 ? `&vote_average.gte=${minRating}` : '';
      
      // Handle language query - if we have a languageSearch context and language is "other", use specific language
      let languageQuery = '';
      if (languageSearch && language === 'other') {
        // Find the language code for the current language search
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
        if (languageCode) {
          languageQuery = `&with_original_language=${languageCode}`;
        }
      } else if (language && language !== 'other') {
        languageQuery = `&with_original_language=${language}`;
      }
      
      const searchQuery = searchTerm ? `&query=${encodeURIComponent(searchTerm)}` : '';
      const pageQuery = `&page=${page}`;
      
      let endpoint;
      if (searchTerm) {
        // For search with term, include language filter in search API
        endpoint = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}${searchQuery}${languageQuery}${pageQuery}`;
      } else {
        // For discovery, use discover API with all filters
        endpoint = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}${genreQuery}${yearQuery}${ratingQuery}${minRatingQuery}${languageQuery}${pageQuery}&sort_by=popularity.desc`;
      }
      
      console.log('API endpoint being called:', endpoint);
      
      const response = await fetch(endpoint);
      const data = await response.json();
      let results = data.results || [];
      const apiReturnedResults = results.length > 0;
      
      console.log('API returned results:', results.length);
      
      // Apply filters to search results that the search API doesn't handle
      if (searchTerm) {
        // Filter by minimum rating
        if (minRating > 0) {
          results = results.filter(movie => movie.vote_average >= minRating);
          console.log('After rating filter:', results.length);
        }
        
        // Filter by language
        if (languageSearch && language === 'other') {
          // Use specific language from context
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
          if (languageCode) {
            console.log('Filtering by language:', languageCode, 'for search:', languageSearch);
            results = results.filter(movie => movie.original_language === languageCode);
            console.log('After language filter:', results.length);
          }
        } else if (language && language !== 'other') {
          console.log('Filtering by language:', language);
          results = results.filter(movie => movie.original_language === language);
          console.log('After language filter:', results.length);
        }
        
        // Filter by genre
        if (selectedGenres.length > 0) {
          results = results.filter(movie => 
            movie.genre_ids && movie.genre_ids.some(id => selectedGenres.includes(id))
          );
          console.log('After genre filter:', results.length);
        }
        
        // Filter by year range
        results = results.filter(movie => {
          if (!movie.release_date) return false;
          const year = parseInt(movie.release_date.split('-')[0]);
          return year >= yearRange.min && year <= yearRange.max;
        });
        console.log('After year filter:', results.length);
      }
      
      // Filter for "Other Languages" when no specific languageSearch context
      if (language === 'other' && !languageSearch) {
        const commonLanguages = ['en', 'hi', 'te', 'ta', 'gu', 'ml', 'mr', 'kn', 'bn', 'th', 'id', 'fr', 'es', 'de', 'it', 'ja', 'ko', 'zh', 'pt', 'ru', 'ar', 'tr', 'sv', 'da', 'no', 'nl', 'pl'];
        results = results.filter(movie => !commonLanguages.includes(movie.original_language));
      }
      
      // Filter out already rated movies to show fresh recommendations
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      results = results.filter(movie => !ratedMovieIds.includes(movie.id));
      
      // Combine with accumulated results
      const allResults = [...accumulatedResults, ...results];
      
      // If we have no results after filtering but API returned results, try next page (up to 5 pages)
      if (allResults.length === 0 && apiReturnedResults && page < 5) {
        console.log(`No results after filtering on page ${page}, trying page ${page + 1}`);
        return searchMovies(page + 1, allResults);
      }
      
      // If we don't have enough movies (less than 10) and there are more pages, fetch next page
      if (allResults.length < 10 && results.length > 0 && page < 10) {
        return searchMovies(page + 1, allResults);
      }
      
      // If no results found after trying multiple pages, show message
      if (allResults.length === 0 && page > 1) {
        console.log('No results found after checking multiple pages. Consider tweaking filters.');
      }
      
      setMovies(allResults);
      setCurrentPage(1); // Reset to page 1 since we're showing accumulated results
    } catch (error) {
      console.error('Error fetching movies:', error);
    }
  };

  const getMovieDetails = async (movieId) => {
    try {
      console.log('Fetching movie details for:', movieId);
      console.log('TMDB API Key:', TMDB_API_KEY ? 'Present' : 'Missing');
      console.log('OMDB API Key:', OMDB_API_KEY ? 'Present' : 'Missing');
      
      const tmdbResponse = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits`);
      const tmdbData = await tmdbResponse.json();
      console.log('TMDB Data:', tmdbData);
      
      const omdbResponse = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_API_KEY}&i=${tmdbData.imdb_id}`);
      const omdbData = await omdbResponse.json();
      console.log('OMDB Data:', omdbData);
      
      return { ...tmdbData, omdbData };
    } catch (error) {
      console.error('Error fetching movie details:', error);
      return null;
    }
  };

  const markAsWatched = (movieId, rating) => {
    const currentRating = watchedMovies[movieId];
    const timestamp = new Date().toISOString();
    
    // Get movie title for history
    const movie = movies.find(m => m.id === movieId);
    const movieTitle = movie ? movie.title : `Movie ${movieId}`;
    
    let updated = { ...watchedMovies };
    let historyEntry = '';
    
    if (currentRating && (typeof currentRating === 'object' ? currentRating.rating === rating : currentRating === rating)) {
      // Remove rating if clicking same rating
      delete updated[movieId];
      historyEntry = `Removed ${rating} from "${movieTitle}" on ${new Date().toLocaleString()}`;
    } else {
      // Add/change rating with timestamp
      updated[movieId] = { rating, ratedAt: timestamp };
      historyEntry = `${rating === 'superlike' ? 'Superliked' : rating === 'like' ? 'Liked' : 'Disliked'} "${movieTitle}" on ${new Date().toLocaleString()}`;
      
      // Remove from watchlist when rated
      const updatedWatchlist = watchlist.filter(id => id !== movieId);
      setWatchlist(updatedWatchlist);
    }
    
    setWatchedMovies(updated);
    
    // Add to history
    const history = JSON.parse(localStorage.getItem('ratingHistory') || '[]');
    history.unshift(historyEntry);
    localStorage.setItem('ratingHistory', JSON.stringify(history));
  };

  const toggleWatchlist = (movieId) => {
    const updated = watchlist.includes(movieId) 
      ? watchlist.filter(id => id !== movieId)
      : [...watchlist, movieId];
    setWatchlist(updated);
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
      <header>
        <h1>Tasteful - Movie Recommendations</h1>
        
        <nav className="navigation">
          <button onClick={() => setCurrentView('home')} className={currentView === 'home' ? 'active' : ''}>
            Home
          </button>
          <button onClick={() => setCurrentView('ratings')} className={currentView === 'ratings' ? 'active' : ''}>
            My Ratings
          </button>
          <button onClick={() => setCurrentView('watchlist')} className={currentView === 'watchlist' ? 'active' : ''}>
            Watchlist
          </button>
        </nav>

        {currentView === 'home' && (
          <div className="search-filters">
            <div className="search-bar">
              <select 
                value={searchCategory} 
                onChange={(e) => setSearchCategory(e.target.value)}
                className="search-category"
              >
                <option value="Movie">Movie</option>
                <option value="Cast">Cast</option>
                <option value="Director">Director</option>
              </select>
              <input
                type="text"
                placeholder={`Search ${searchCategory.toLowerCase()}s...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && performSearch()}
                className="search-input"
              />
            </div>
            
            <div className="genres">
              <h3>Genres:</h3>
              <div className="genre-list">
                {displayedGenres.map(genre => (
                  <label key={genre.id}>
                    <input
                      type="checkbox"
                      checked={selectedGenres.includes(genre.id)}
                      onChange={() => handleGenreChange(genre.id)}
                    />
                    {genre.name}
                  </label>
                ))}
              </div>
              {showMoreButton && (
                <button 
                  type="button"
                  onClick={() => setShowAllGenres(!showAllGenres)}
                  className="show-more-genres"
                >
                  {showAllGenres ? 'Show Less Genres' : 'Show More Genres'}
                </button>
              )}
            </div>
            
            <div className="filters-row">
              <div className="year-range">
                <h3>Year Range:</h3>
                <div className="year-selects">
                  <select 
                    value={yearRange.min} 
                    onChange={(e) => setYearRange(prev => ({ ...prev, min: parseInt(e.target.value) }))}
                    className="year-select"
                  >
                    {Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i).map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                  <span className="year-separator">to</span>
                  <select 
                    value={yearRange.max} 
                    onChange={(e) => setYearRange(prev => ({ ...prev, max: parseInt(e.target.value) }))}
                    className="year-select"
                  >
                    {Array.from({ length: currentYear - 1900 + 1 }, (_, i) => currentYear - i).map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="rating-filter">
                <h3>Content Rating:</h3>
                <select value={selectedRating} onChange={(e) => setSelectedRating(e.target.value)}>
                  <option value="">All Ratings</option>
                  <option value="G">G (General Audiences)</option>
                  <option value="PG">PG (Parental Guidance)</option>
                  <option value="PG-13">PG-13 (Parents Strongly Cautioned)</option>
                  <option value="R">R (Restricted)</option>
                  <option value="NC-17">NC-17 (Adults Only)</option>
                </select>
              </div>
              
              <div className="min-rating-filter">
                <h3>Minimum Rating: {minRating}/10</h3>
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
              
              <div className="language-filter">
                <h3>Language:</h3>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="">All Languages</option>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="te">Telugu</option>
                  <option value="ta">Tamil</option>
                  <option value="gu">Gujarati</option>
                  <option value="ml">Malayalam</option>
                  <option value="mr">Marathi</option>
                  <option value="kn">Kannada</option>
                  <option value="bn">Bengali</option>
                  <option value="ar">Arabic</option>
                  <option value="zh">Chinese (Mandarin)</option>
                  <option value="da">Danish</option>
                  <option value="nl">Dutch</option>
                  <option value="fi">Finnish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="id">Indonesian</option>
                  <option value="it">Italian</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="no">Norwegian</option>
                  <option value="pl">Polish</option>
                  <option value="pt">Portuguese</option>
                  <option value="ru">Russian</option>
                  <option value="sr">Serbian</option>
                  <option value="es">Spanish</option>
                  <option value="sv">Swedish</option>
                  <option value="th">Thai</option>
                  <option value="tr">Turkish</option>
                  <option value="other">Other Languages</option>
                </select>
              </div>
            </div>
            
            <button onClick={performSearch}>Search</button>
          </div>
        )}
      </header>

      <main>
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
            
            <div className="movies-grid">
              {movies.map(movie => (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  isWatched={watchedMovies[movie.id]}
                  isInWatchlist={watchlist.includes(movie.id)}
                  onMarkWatched={markAsWatched}
                  onToggleWatchlist={toggleWatchlist}
                  getMovieDetails={getMovieDetails}
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
              ))}
            </div>
            
            {movies.length > 0 && !directorSearch && !castSearch && !genreSearch && !languageSearch && (
              <div className="pagination">
                <button 
                  onClick={() => searchMovies(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                
                <span className="page-info">
                  Page {currentPage}
                </span>
                
                <button 
                  onClick={() => searchMovies(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
        
        {currentView === 'watchlist' && (
          <WatchlistView 
            watchlist={watchlist} 
            onToggleWatchlist={toggleWatchlist}
            onMarkWatched={markAsWatched}
            getMovieDetails={getMovieDetails}
          />
        )}
        
        {currentView === 'ratings' && (
          <MyRatingsView watchedMovies={watchedMovies} onMarkWatched={markAsWatched} />
        )}
      </main>
    </div>
  );
}

function MovieCard({ movie, isWatched, isInWatchlist, onMarkWatched, onToggleWatchlist, getMovieDetails, onDirectorClick, onCastClick, onGenreClick, onLanguageClick }) {
  const [details, setDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

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
      const movieDetails = await getMovieDetails(movie.id);
      setDetails(movieDetails);
    }
    setShowDetails(!showDetails);
  };

  // Get current rating (handle both old string format and new object format)
  const currentRating = isWatched ? (typeof isWatched === 'object' ? isWatched.rating : isWatched) : null;

  return (
    <div className="movie-card">
      <div className="poster-container">
        <img
          src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
          alt={movie.title}
          onClick={loadDetails}
          className="movie-poster"
        />
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
      </div>
      <h3 onClick={loadDetails} className="movie-title">{movie.title}</h3>
      <p>Year: {movie.release_date?.split('-')[0]}</p>
      <p>Rating: {movie.vote_average.toFixed(1)}/10</p>
      
      <div className="actions">
        {onToggleWatchlist && (
          <button onClick={() => onToggleWatchlist(movie.id)}>
            {isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
          </button>
        )}
        
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
        <div className="movie-details">
          <p><strong>Description:</strong> {details.runtime && <><strong>[</strong><strong><em>{details.runtime} min</em></strong><strong>]</strong> </>}{details.overview}</p>
          <div className="genre-language-column">
            <p><strong>Genre:</strong> {details.genres?.map((g, index) => (
              <span key={g.id}>
                <span 
                  className="clickable-person"
                  onClick={() => onGenreClick && onGenreClick(g.name)}
                >
                  {g.name}
                </span>
                {index < details.genres.length - 1 ? ', ' : ''}
              </span>
            ))}</p>
            <p><strong>Language:</strong> 
              <span 
                className="clickable-person"
                onClick={() => onLanguageClick && onLanguageClick(details.original_language)}
              >
                {getLanguageName(details.original_language)}
              </span>
            </p>
          </div>
          <p><strong>Director:</strong> 
            {details.credits?.crew?.find(c => c.job === 'Director') && (
              <span 
                className="clickable-person"
                onClick={() => onDirectorClick && onDirectorClick(details.credits.crew.find(c => c.job === 'Director').name)}
              >
                {details.credits.crew.find(c => c.job === 'Director').name}
              </span>
            )}
          </p>
          <p><strong>Cast:</strong> 
            {details.credits?.cast?.slice(0, 10).map((actor, index) => (
              <span key={actor.id}>
                <span 
                  className="clickable-person"
                  onClick={() => onCastClick && onCastClick(actor.name)}
                >
                  {actor.name}
                </span>
                {index < Math.min(details.credits.cast.length - 1, 9) ? ', ' : ''}
              </span>
            ))}
          </p>
          <p><strong>IMDB:</strong> {details.omdbData?.imdbRating}/10</p>
          <p><strong>Rotten Tomatoes:</strong> {details.omdbData?.Ratings?.find(r => r.Source === 'Rotten Tomatoes')?.Value}</p>
        </div>
      )}
    </div>
  );
}

function MyRatingsView({ watchedMovies, onMarkWatched }) {
  const [ratedMovies, setRatedMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('date'); // 'date', 'title-asc', 'title-desc'
  const [showHistory, setShowHistory] = useState(false);
  const moviesPerPage = 25;

  useEffect(() => {
    const fetchRatedMovies = async () => {
      const movieEntries = Object.entries(watchedMovies);
      const movies = [];
      
      for (const [movieId, ratingData] of movieEntries) {
        try {
          const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
          const movieData = await response.json();
          
          // Handle both old format (string) and new format (object)
          const rating = typeof ratingData === 'string' ? ratingData : ratingData.rating;
          const ratedAt = typeof ratingData === 'object' ? ratingData.ratedAt : Date.now();
          
          movies.push({ 
            ...movieData, 
            userRating: rating,
            ratedAt: ratedAt
          });
        } catch (error) {
          console.error('Error fetching rated movie:', error);
        }
      }
      
      setRatedMovies(movies);
    };

    if (Object.keys(watchedMovies).length > 0) {
      fetchRatedMovies();
    } else {
      setRatedMovies([]);
    }
  }, [watchedMovies]);

  const getRatingIcon = (rating) => {
    switch (rating) {
      case 'dislike': return '👎';
      case 'like': return '👍';
      case 'superlike': return '❤️';
      default: return '';
    }
  };

  // Fuzzy search function
  const filteredMovies = ratedMovies.filter(movie =>
    movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    movie.release_date?.includes(searchTerm)
  );

  // Sorting function
  const sortedMovies = [...filteredMovies].sort((a, b) => {
    switch (sortBy) {
      case 'title-asc':
        return a.title.localeCompare(b.title);
      case 'title-desc':
        return b.title.localeCompare(a.title);
      case 'date':
      default:
        return new Date(b.ratedAt) - new Date(a.ratedAt);
    }
  });

  // Pagination
  const totalPages = Math.ceil(sortedMovies.length / moviesPerPage);
  const startIndex = (currentPage - 1) * moviesPerPage;
  const currentMovies = sortedMovies.slice(startIndex, startIndex + moviesPerPage);

  if (showHistory) {
    return <RatingHistoryView onBack={() => setShowHistory(false)} />;
  }

  return (
    <div className="my-ratings">
      <div className="ratings-header">
        <h2>My Rated Movies ({filteredMovies.length})</h2>
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
          <option value="date">Sort by Date Rated (Recent First)</option>
          <option value="title-asc">Sort by Title (A-Z)</option>
          <option value="title-desc">Sort by Title (Z-A)</option>
        </select>
      </div>

      {filteredMovies.length === 0 ? (
        <p>No movies rated yet. Start rating movies to see them here!</p>
      ) : (
        <>
          <div className="movies-grid">
            {currentMovies.map(movie => (
              <div key={movie.id} className="movie-card rated-movie">
                <img
                  src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
                  alt={movie.title}
                  className="movie-poster"
                />
                <h3 className="movie-title">{movie.title}</h3>
                <p>Year: {movie.release_date?.split('-')[0]}</p>
                <p>Rating: {movie.vote_average?.toFixed(1)}/10</p>
                
                <div className="rating-buttons">
                  <button 
                    onClick={() => onMarkWatched(movie.id, 'dislike')}
                    className={`rating-btn ${movie.userRating === 'dislike' ? 'active-dislike' : ''}`}
                  >
                    👎
                  </button>
                  <button 
                    onClick={() => onMarkWatched(movie.id, 'like')}
                    className={`rating-btn ${movie.userRating === 'like' ? 'active-like' : ''}`}
                  >
                    👍
                  </button>
                  <button 
                    onClick={() => onMarkWatched(movie.id, 'superlike')}
                    className={`rating-btn ${movie.userRating === 'superlike' ? 'active-superlike' : ''}`}
                  >
                    ❤️
                  </button>
                </div>
                
                <div className="rating-info">
                  <div className="current-rating">
                    {getRatingIcon(movie.userRating)} {movie.userRating}
                  </div>
                  <div className="rated-date">
                    Rated: {new Date(movie.ratedAt).toLocaleDateString()}
                  </div>
                </div>
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
                Page {currentPage} of {totalPages} ({moviesPerPage} per page)
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

function WatchlistView({ watchlist, onToggleWatchlist, onMarkWatched, getMovieDetails }) {
  const [watchlistMovies, setWatchlistMovies] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const moviesPerPage = 25;

  useEffect(() => {
    const fetchWatchlistMovies = async () => {
      const movies = [];
      
      for (const movieId of watchlist) {
        try {
          const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
          const movieData = await response.json();
          movies.push(movieData);
        } catch (error) {
          console.error('Error fetching watchlist movie:', error);
        }
      }
      
      setWatchlistMovies(movies);
    };

    if (watchlist.length > 0) {
      fetchWatchlistMovies();
    } else {
      setWatchlistMovies([]);
    }
  }, [watchlist]);

  // Search functionality
  const filteredMovies = watchlistMovies.filter(movie =>
    movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    movie.release_date?.includes(searchTerm)
  );

  // Pagination
  const totalPages = Math.ceil(filteredMovies.length / moviesPerPage);
  const startIndex = (currentPage - 1) * moviesPerPage;
  const currentMovies = filteredMovies.slice(startIndex, startIndex + moviesPerPage);

  return (
    <div className="watchlist-view">
      <h2>My Watchlist ({filteredMovies.length})</h2>
      
      <div className="watchlist-controls">
        <input
          type="text"
          placeholder="Search your watchlist..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="search-input"
        />
      </div>

      {filteredMovies.length === 0 ? (
        <p>No movies in watchlist yet. Add movies from the home page!</p>
      ) : (
        <>
          <div className="movies-grid">
            {currentMovies.map(movie => (
              <MovieCard
                key={movie.id}
                movie={movie}
                isWatched={null}
                isInWatchlist={true}
                onMarkWatched={onMarkWatched}
                onToggleWatchlist={onToggleWatchlist}
                getMovieDetails={getMovieDetails}
                onDirectorClick={null}
                onCastClick={null}
                onGenreClick={null}
                onLanguageClick={null}
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
                Page {currentPage} of {totalPages} ({moviesPerPage} per page)
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
