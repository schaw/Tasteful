import React, { useState, useEffect } from 'react';
import './App.css';

const TMDB_API_KEY = process.env.REACT_APP_TMDB_API_KEY || '692135011495791f35e255a0b941a6e9';
const OMDB_API_KEY = process.env.REACT_APP_OMDB_API_KEY || '9b24abc';

function App() {
  const [movies, setMovies] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [yearRange, setYearRange] = useState({ min: 1900, max: 2024 });
  const [selectedRating, setSelectedRating] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [currentView, setCurrentView] = useState('home');
  const [currentPage, setCurrentPage] = useState(1);
  const [watchedMovies, setWatchedMovies] = useState(JSON.parse(localStorage.getItem('watchedMovies') || '{}'));
  const [watchlist, setWatchlist] = useState(JSON.parse(localStorage.getItem('watchlist') || '[]'));

  const genres = [
    { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
    { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
    { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
    { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' },
    { id: 10770, name: 'TV Movie' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' },
    { id: 37, name: 'Western' }
  ];

  useEffect(() => {
    searchMovies();
  }, []);

  const searchMovies = async (page = 1) => {
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
      
      setMovies(results);
      setCurrentPage(page);
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
    const updated = { ...watchedMovies, [movieId]: rating };
    setWatchedMovies(updated);
    localStorage.setItem('watchedMovies', JSON.stringify(updated));
  };

  const toggleWatchlist = (movieId) => {
    const updated = watchlist.includes(movieId) 
      ? watchlist.filter(id => id !== movieId)
      : [...watchlist, movieId];
    setWatchlist(updated);
    localStorage.setItem('watchlist', JSON.stringify(updated));
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
            
            <div className="year-range">
              <h3>Year Range:</h3>
              <input
                type="number"
                placeholder="From"
                value={yearRange.min}
                onChange={(e) => setYearRange(prev => ({ ...prev, min: parseInt(e.target.value) }))}
              />
              <input
                type="number"
                placeholder="To"
                value={yearRange.max}
                onChange={(e) => setYearRange(prev => ({ ...prev, max: parseInt(e.target.value) }))}
              />
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
            
            <button onClick={() => searchMovies(1)}>Search</button>
          </div>
        )}
      </header>

      <main>
        {currentView === 'home' && (
          <>
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
                />
              ))}
            </div>
            
            {movies.length > 0 && (
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
        
        {currentView === 'ratings' && (
          <MyRatingsView watchedMovies={watchedMovies} onMarkWatched={markAsWatched} />
        )}
      </main>
    </div>
  );
}

function MovieCard({ movie, isWatched, isInWatchlist, onMarkWatched, onToggleWatchlist, getMovieDetails }) {
  const [details, setDetails] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const loadDetails = async () => {
    if (!details) {
      const movieDetails = await getMovieDetails(movie.id);
      setDetails(movieDetails);
    }
    setShowDetails(!showDetails);
  };

  return (
    <div className="movie-card">
      <img
        src={`https://image.tmdb.org/t/p/w300${movie.poster_path}`}
        alt={movie.title}
        onClick={loadDetails}
      />
      <h3>{movie.title}</h3>
      <p>Year: {movie.release_date?.split('-')[0]}</p>
      <p>Rating: {movie.vote_average.toFixed(1)}/10</p>
      
      <div className="actions">
        <button onClick={() => onToggleWatchlist(movie.id)}>
          {isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
        </button>
        
        {!isWatched && (
          <div>
            <button onClick={() => onMarkWatched(movie.id, 'dislike')}>👎</button>
            <button onClick={() => onMarkWatched(movie.id, 'like')}>👍</button>
            <button onClick={() => onMarkWatched(movie.id, 'superlike')}>❤️</button>
          </div>
        )}
        
        {isWatched && <span>Watched: {isWatched}</span>}
      </div>

      {showDetails && details && (
        <div className="movie-details">
          <p><strong>Description:</strong> {details.overview}</p>
          <p><strong>Director:</strong> {details.credits?.crew?.find(c => c.job === 'Director')?.name}</p>
          <p><strong>Cast:</strong> {details.credits?.cast?.slice(0, 10).map(c => c.name).join(', ')}</p>
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
  const moviesPerPage = 12;

  useEffect(() => {
    const fetchRatedMovies = async () => {
      const movieIds = Object.keys(watchedMovies);
      const movies = [];
      
      for (const movieId of movieIds) {
        try {
          const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`);
          const movieData = await response.json();
          movies.push({ 
            ...movieData, 
            userRating: watchedMovies[movieId],
            ratedAt: Date.now() // Add timestamp for sorting
          });
        } catch (error) {
          console.error('Error fetching rated movie:', error);
        }
      }
      
      // Sort by most recently rated first
      movies.sort((a, b) => b.ratedAt - a.ratedAt);
      setRatedMovies(movies);
    };

    if (Object.keys(watchedMovies).length > 0) {
      fetchRatedMovies();
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

  // Pagination
  const totalPages = Math.ceil(filteredMovies.length / moviesPerPage);
  const startIndex = (currentPage - 1) * moviesPerPage;
  const currentMovies = filteredMovies.slice(startIndex, startIndex + moviesPerPage);

  return (
    <div className="my-ratings">
      <h2>My Rated Movies ({filteredMovies.length})</h2>
      
      <div className="ratings-search">
        <input
          type="text"
          placeholder="Search your rated movies..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1); // Reset to first page on search
          }}
          className="search-input"
        />
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
                />
                <h3>{movie.title}</h3>
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
                
                <div className="current-rating">
                  Current: {getRatingIcon(movie.userRating)} {movie.userRating}
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
                Page {currentPage} of {totalPages}
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
