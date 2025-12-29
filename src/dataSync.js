import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export const syncUserData = async (userId, data) => {
  try {
    await setDoc(doc(db, 'users', userId), data, { merge: true });
    console.log('Data synced to Firebase');
  } catch (error) {
    console.error('Error syncing data:', error);
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
export const migrateLocalStorageToFirebase = async (userId) => {
  try {
    const localWatchedMovies = JSON.parse(localStorage.getItem('watchedMovies') || '{}');
    const localWatchlist = JSON.parse(localStorage.getItem('watchlist') || '{}');
    const localRatingHistory = JSON.parse(localStorage.getItem('ratingHistory') || '[]');
    
    if (Object.keys(localWatchedMovies).length > 0 || 
        Object.keys(localWatchlist).length > 0 || 
        localRatingHistory.length > 0) {
      
      await syncUserData(userId, {
        watchedMovies: localWatchedMovies,
        watchlist: localWatchlist,
        ratingHistory: localRatingHistory
      });
      
      // Clear localStorage after successful migration
      localStorage.removeItem('watchedMovies');
      localStorage.removeItem('watchlist');
      localStorage.removeItem('ratingHistory');
      
      console.log('Local data migrated to Firebase');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error migrating data:', error);
    return false;
  }
};
