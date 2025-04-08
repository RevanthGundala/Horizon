import React, { useState, useEffect } from 'react';
import '../styles/Login.css';
import { getUrl } from '../utils/api';
import { useNavigate } from '@tanstack/react-router';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [hasOfflineData, setHasOfflineData] = useState(false);

  // Check for network status and offline data
  useEffect(() => {
    // Check initial status
    setIsOffline(!navigator.onLine);
    
    // Check if we have offline data
    const storedUserId = localStorage.getItem('horizon-user-id');
    setHasOfflineData(!!storedUserId);
    
    // Set up event listeners for online/offline status
    const handleOnline = () => {
      console.log('Login is online');
      setIsOffline(false);
    };
    
    const handleOffline = () => {
      console.log('Login is offline');
      setIsOffline(true);
    };
    
    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Clean up
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Handle offline login
  const handleOfflineLogin = () => {
    // Set a temporary user ID if none exists
    if (!localStorage.getItem('horizon-user-id')) {
      localStorage.setItem('horizon-user-id', 'offline-user-' + Date.now());
    }
    
    // Navigate to home page
    navigate({ to: '/' });
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Horizon</h1>
          <p>Your personal knowledge workspace</p>
        </div>
        
        <div className="login-content">
          <h2>Welcome back</h2>
          <p className="login-description">
            Sign in to access your notes, documents, and workspaces.
          </p>
          
          {isOffline ? (
            <div className="offline-login">
              <p className="offline-message">
                You are currently offline. {hasOfflineData ? 'You can continue with your offline data.' : 'No offline data available.'}
              </p>
              
              {hasOfflineData && (
                <button 
                  className="login-button offline-button"
                  onClick={handleOfflineLogin}
                >
                  Continue Offline
                </button>
              )}
            </div>
          ) : (
            <a 
              className="login-button"
              href={getUrl('/api/auth/login')}
              style={{ display: 'inline-block', textDecoration: 'none', textAlign: 'center' }}
            >
              Sign in with WorkOS
            </a>
          )}
          
          <div className="login-footer">
            <p>Don't have an account? Contact your administrator.</p>
            {isOffline && !hasOfflineData && (
              <p className="offline-note">
                You need to sign in at least once while online to use offline mode.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
