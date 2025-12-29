import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase';

function AuthComponent({ user, onAuthChange }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
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
          <span>Welcome, {user.email}</span>
          <button onClick={handleSignOut} className="auth-btn">Sign Out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-form">
        <h2>{isLogin ? 'Sign In' : 'Sign Up'}</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={loading} className="auth-btn">
            {loading ? 'Loading...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <p>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button" 
            onClick={() => setIsLogin(!isLogin)}
            className="link-btn"
          >
            {isLogin ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default AuthComponent;
