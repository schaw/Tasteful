import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from './firebase';

function AuthComponent({ user, onAuthChange }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      setError(error.message);
    }
  };

  if (user) {
    return (
      <div className="auth-container">
        <div className="user-info">
          <span>Welcome, {user.displayName || user.email}</span>
          <button onClick={handleSignOut} className="auth-btn">Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-form">
        <h2>Sign In to Sync Your Data</h2>
        <button 
          onClick={handleGoogleSignIn} 
          disabled={loading} 
          className="google-signin-btn"
        >
          {loading ? 'Signing in...' : '🔍 Sign in with Google'}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="auth-note">
          Sign in to sync your ratings and watchlist across devices
        </p>
      </div>
    </div>
  );
}

export default AuthComponent;
