import React, { useState, useEffect } from 'react';
import './App.css';

const TMDB_API_KEY = process.env.REACT_APP_TMDB_API_KEY || '692135011495791f35e255a0b941a6e9';
const OMDB_API_KEY = process.env.REACT_APP_OMDB_API_KEY || '9b24abc';

function App() {
  const [movies, setMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const currentYear = new Date().getFullYear();
  const [yearRange, setYearRange] = useState({ min: currentYear - 5, max: currentYear });
  const [selectedRating, setSelectedRating] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [currentView, setCurrentView] = useState('home');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [directorSearch, setDirectorSearch] = useState(null);
  const [castSearch, setCastSearch] = useState(null);
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

  useEffect(() => {
    searchMovies();
  }, []);

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

  const searchMoviesByDirector = async (directorName) => {
    try {
      // First, search for the director to get their ID
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(directorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        console.log('Director not found');
        setMovies([]);
        return;
      }
      
      const directorId = personData.results[0].id;
      
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
      setDirectorSearch(directorName);
      setCastSearch(null);
    } catch (error) {
      console.error('Error fetching director movies:', error);
    }
  };

  const searchMoviesByCast = async (actorName) => {
    try {
      // First, search for the actor to get their ID
      const personResponse = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(actorName)}`);
      const personData = await personResponse.json();
      
      if (!personData.results || personData.results.length === 0) {
        console.log('Actor not found');
        setMovies([]);
        return;
      }
      
      const actorId = personData.results[0].id;
      
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
      setCastSearch(actorName);
      setDirectorSearch(null);
    } catch (error) {
      console.error('Error fetching cast movies:', error);
    }
  };

  const clearPersonSearch = () => {
    setDirectorSearch(null);
    setCastSearch(null);
    searchMovies();
  };

  const searchMovies = async (page = 1, accumulatedResults = []) => {
    try {
      const genreQuery = selectedGenres.length ? `&with_genres=${selectedGenres.join(',')}` : '';
      const yearQuery = `&primary_release_date.gte=${yearRange.min}-01-01&primary_release_date.lte=${yearRange.max}-12-31`;
      const ratingQuery = selectedRating ? `&certification_country=US&certification=${selectedRating}` : '';
      const minRatingQuery = minRating > 0 ? `&vote_average.gte=${minRating}` : '';
      const searchQuery = searchTerm ? `&query=${encodeURIComponent(searchTerm)}` : '';
      const pageQuery = `&page=${page}`;
      
      const endpoint = searchTerm 
        ? `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}${searchQuery}${pageQuery}`
        : `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}${genreQuery}${yearQuery}${ratingQuery}${minRatingQuery}${pageQuery}&sort_by=popularity.desc`;
      
      const response = await fetch(endpoint);
      const data = await response.json();
      let results = data.results || [];
      
      // Filter by minimum rating for search results too
      if (searchTerm && minRating > 0) {
        results = results.filter(movie => movie.vote_average >= minRating);
      }
      
      // Filter out already rated movies to show fresh recommendations
      const ratedMovieIds = Object.keys(watchedMovies).map(id => parseInt(id));
      results = results.filter(movie => !ratedMovieIds.includes(movie.id));
      
      // Combine with accumulated results
      const allResults = [...accumulatedResults, ...results];
      
      // If we don't have enough movies (less than 10) and there are more pages, fetch next page
      if (allResults.length < 10 && results.length > 0 && page < 10) {
        return searchMovies(page + 1, allResults);
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
            <input
              type="text"
              placeholder="Search movies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            
            <div className="genres">
              <h3>Genres:</h3>
              <div className="genre-list">
                {genres.map(genre => (
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
              <button 
                type="button"
                onClick={() => setShowAllGenres(!showAllGenres)}
                className="show-more-genres"
              >
                {showAllGenres ? 'Show Less Genres' : 'Show More Genres'}
              </button>
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
            </div>
            
            <button onClick={() => {
              if (directorSearch) {
                searchMoviesByDirector(directorSearch);
              } else if (castSearch) {
                searchMoviesByCast(castSearch);
              } else {
                searchMovies(1);
              }
            }}>Search</button>
          </div>
        )}
      </header>

      <main>
        {currentView === 'home' && (
          <>
            {(directorSearch || castSearch) && (
              <div className="search-info">
                <p>
                  Showing movies by {directorSearch ? `director: ${directorSearch}` : `actor: ${castSearch}`}
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
                  onDirectorClick={searchMoviesByDirector}
                  onCastClick={searchMoviesByCast}
                />
              ))}
            </div>
            
            {movies.length > 0 && !directorSearch && !castSearch && (
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

function MovieCard({ movie, isWatched, isInWatchlist, onMarkWatched, onToggleWatchlist, getMovieDetails, onDirectorClick, onCastClick }) {
  const [details, setDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

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
      <img
        src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
        alt={movie.title}
        onClick={loadDetails}
        className="movie-poster"
      />
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
          <p><strong>Description:</strong> {details.overview}</p>
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
