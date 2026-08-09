import { doc, setDoc, getDoc, deleteField } from 'firebase/firestore';
import { db } from './firebase';

// SAFE sync: only include non-empty map fields in the payload.
// Firestore merge:true with an empty map ({}) OVERWRITES the entire field.
// By omitting empty maps, we prevent accidental data wipes.
export const syncUserData = async (userId, data) => {
  try {
    console.log('Attempting to sync data for user:', userId);
    
    // Filter out empty objects/arrays to prevent merge:true from wiping fields
    const safeData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        // Skip empty objects - merge:true with {} would wipe the field
        console.log(`syncUserData: skipping empty map field "${key}" to prevent wipe`);
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        // Skip empty arrays too - same risk
        console.log(`syncUserData: skipping empty array field "${key}" to prevent wipe`);
        continue;
      }
      safeData[key] = value;
    }
    
    if (Object.keys(safeData).length === 0) {
      console.log('syncUserData: nothing to sync (all fields empty), skipping');
      return;
    }
    
    await setDoc(doc(db, 'users', userId), safeData, { merge: true });
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
// SAFE: Only migrates fields that have actual data, and checks Firebase first
// to avoid overwriting richer server data with stale/empty local data.
// Also guards against cross-account contamination: if localStorage was written
// by a different UID, clear it and skip migration.
export const migrateLocalStorageToFirebase = async (userId) => {
  try {
    // Cross-account contamination guard
    const lastSyncedUid = localStorage.getItem('lastSyncedUid');
    if (lastSyncedUid && lastSyncedUid !== userId) {
      console.log(`migrateLocalStorageToFirebase: localStorage belongs to different UID (${lastSyncedUid} != ${userId}) - clearing and skipping migration`);
      localStorage.removeItem('watchedMovies');
      localStorage.removeItem('watchlist');
      localStorage.removeItem('watchedList');
      localStorage.removeItem('ratingHistory');
      localStorage.removeItem('moviesDatabase');
      localStorage.removeItem('userInteractions');
      localStorage.setItem('lastSyncedUid', userId);
      return false;
    }
    
    const localWatchedMovies = JSON.parse(localStorage.getItem('watchedMovies') || '{}');
    const localWatchlist = JSON.parse(localStorage.getItem('watchlist') || '{}');
    const localWatchedList = JSON.parse(localStorage.getItem('watchedList') || '{}');
    const localRatingHistory = JSON.parse(localStorage.getItem('ratingHistory') || '[]');
    const localMoviesDatabase = JSON.parse(localStorage.getItem('moviesDatabase') || '{}');
    const localUserInteractions = JSON.parse(localStorage.getItem('userInteractions') || '[]');
    
    // Only consider user-facing data (not moviesDatabase cache) for migration trigger
    const hasUserData = Object.keys(localWatchedMovies).length > 0 || 
        Object.keys(localWatchlist).length > 0 || 
        Object.keys(localWatchedList).length > 0 ||
        localRatingHistory.length > 0;
    
    if (!hasUserData) {
      // No actual user data to migrate - just clean up stale localStorage cache
      // DO NOT send empty maps to Firebase (this was the bug that wiped data)
      console.log('migrateLocalStorageToFirebase: no user data in localStorage, skipping migration');
      // Still clean localStorage cache to avoid future false triggers
      localStorage.removeItem('moviesDatabase');
      localStorage.removeItem('userInteractions');
      return false;
    }
    
    // Check if Firebase already has MORE data than localStorage
    // If so, don't overwrite - the server version is authoritative
    const existingData = await getUserData(userId);
    const existingCount = Object.keys(existingData.watchedMovies || {}).length + 
                          Object.keys(existingData.watchlist || {}).length;
    const localCount = Object.keys(localWatchedMovies).length + 
                       Object.keys(localWatchlist).length;
    
    if (existingCount > localCount) {
      console.log(`migrateLocalStorageToFirebase: Firebase has ${existingCount} items vs localStorage ${localCount} - keeping Firebase data`);
      // Clean localStorage since Firebase is richer
      localStorage.removeItem('watchedMovies');
      localStorage.removeItem('watchlist');
      localStorage.removeItem('watchedList');
      localStorage.removeItem('ratingHistory');
      localStorage.removeItem('moviesDatabase');
      localStorage.removeItem('userInteractions');
      localStorage.setItem('lastSyncedUid', userId);
      return false;
    }
    
    // Build migration payload - only include non-empty fields
    const migrationData = {};
    if (Object.keys(localWatchedMovies).length > 0) migrationData.watchedMovies = localWatchedMovies;
    if (Object.keys(localWatchlist).length > 0) migrationData.watchlist = localWatchlist;
    if (Object.keys(localWatchedList).length > 0) migrationData.watchedList = localWatchedList;
    if (localRatingHistory.length > 0) migrationData.ratingHistory = localRatingHistory;
    if (Object.keys(localMoviesDatabase).length > 0) migrationData.moviesDatabase = localMoviesDatabase;
    if (localUserInteractions.length > 0) migrationData.userInteractions = localUserInteractions;
    
    await syncUserData(userId, migrationData);
    
    // Clear localStorage after successful migration
    localStorage.removeItem('watchedMovies');
    localStorage.removeItem('watchlist');
    localStorage.removeItem('watchedList');
    localStorage.removeItem('ratingHistory');
    localStorage.removeItem('moviesDatabase');
    localStorage.removeItem('userInteractions');
    localStorage.setItem('lastSyncedUid', userId);
    
    console.log('Local data migrated to Firebase (only non-empty fields)');
    return true;
  } catch (error) {
    console.error('Error migrating data:', error);
    return false;
  }
};

// BACKUP: Export all user data as a downloadable JSON file
export const exportUserDataBackup = async (userId) => {
  try {
    const userData = await getUserData(userId);
    const backup = {
      exportedAt: new Date().toISOString(),
      userId: userId,
      ...userData
    };
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasteful_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Backup exported successfully');
    return true;
  } catch (error) {
    console.error('Error exporting backup:', error);
    return false;
  }
};

// RESTORE: Import user data from a backup JSON file
export const importUserDataBackup = async (userId, backupJson) => {
  try {
    const backup = JSON.parse(backupJson);
    
    // Validate backup structure
    if (!backup.watchedMovies && !backup.watchlist && !backup.ratingHistory) {
      throw new Error('Invalid backup file: missing expected fields');
    }
    
    const restoreData = {};
    if (backup.watchedMovies && Object.keys(backup.watchedMovies).length > 0) {
      restoreData.watchedMovies = backup.watchedMovies;
    }
    if (backup.watchlist && Object.keys(backup.watchlist).length > 0) {
      restoreData.watchlist = backup.watchlist;
    }
    if (backup.ratingHistory && backup.ratingHistory.length > 0) {
      restoreData.ratingHistory = backup.ratingHistory;
    }
    if (backup.moviesDatabase && Object.keys(backup.moviesDatabase).length > 0) {
      restoreData.moviesDatabase = backup.moviesDatabase;
    }
    if (backup.userInteractions && backup.userInteractions.length > 0) {
      restoreData.userInteractions = backup.userInteractions;
    }
    
    if (Object.keys(restoreData).length === 0) {
      throw new Error('Backup file contains no data to restore');
    }
    
    await syncUserData(userId, restoreData);
    console.log('Backup restored successfully');
    return restoreData;
  } catch (error) {
    console.error('Error importing backup:', error);
    throw error;
  }
};
