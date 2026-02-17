import { doc, setDoc, getDoc, deleteField } from 'firebase/firestore';
import { db } from './firebase';

export const syncUserData = async (userId, data) => {
  try {
    console.log('Attempting to sync data for user:', userId);
    await setDoc(doc(db, 'users', userId), data, { merge: true });
    console.log('Data synced to Firebase successfully');
  } catch (error) {
    console.error('Error syncing data to Firebase:', error);
    throw error;
  }
};

export const removeFromCollection = async (userId, collection, key) => {
  try {
    await setDoc(doc(db, 'users', userId), {
      [collection]: { [key]: deleteField() }
    }, { merge: true });
    console.log(`Removed ${key} from ${collection} in Firebase`);
  } catch (error) {
    console.error(`Error removing ${key} from ${collection}:`, error);
    throw error;
  }
};

export const getUserData = async (userId) => {
  try {
    const docRef = doc(db, 'users', userId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data();
    } else {
      return {
        watchedMovies: {},
        watchlist: {},
        ratingHistory: []
      };
    }
  } catch (error) {
    console.error('Error getting user data:', error);
    return {
      watchedMovies: {},
      watchlist: {},
      ratingHistory: []
    };
  }
};

// Migrate localStorage data to Firebase (one-time migration)
// Includes moviesDatabase so cached metadata is preserved
export const migrateLocalStorageToFirebase = async (userId) => {
  try {
    const localWatchedMovies = JSON.parse(localStorage.getItem('watchedMovies') || '{}');
    const localWatchlist = JSON.parse(localStorage.getItem('watchlist') || '{}');
    const localWatchedList = JSON.parse(localStorage.getItem('watchedList') || '{}');
    const localRatingHistory = JSON.parse(localStorage.getItem('ratingHistory') || '[]');
    const localMoviesDatabase = JSON.parse(localStorage.getItem('moviesDatabase') || '{}');
    const localUserInteractions = JSON.parse(localStorage.getItem('userInteractions') || '[]');
    
    const hasData = Object.keys(localWatchedMovies).length > 0 || 
        Object.keys(localWatchlist).length > 0 || 
        Object.keys(localWatchedList).length > 0 ||
        localRatingHistory.length > 0 ||
        Object.keys(localMoviesDatabase).length > 0;
    
    if (hasData) {
      await syncUserData(userId, {
        watchedMovies: localWatchedMovies,
        watchlist: localWatchlist,
        watchedList: localWatchedList,
        ratingHistory: localRatingHistory,
        moviesDatabase: localMoviesDatabase,
        userInteractions: localUserInteractions
      });
      
      // Clear localStorage after successful migration
      localStorage.removeItem('watchedMovies');
      localStorage.removeItem('watchlist');
      localStorage.removeItem('watchedList');
      localStorage.removeItem('ratingHistory');
      localStorage.removeItem('moviesDatabase');
      localStorage.removeItem('userInteractions');
      
      console.log('Local data migrated to Firebase (including moviesDatabase)');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error migrating data:', error);
    return false;
  }
};
