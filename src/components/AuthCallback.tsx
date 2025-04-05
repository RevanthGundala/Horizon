import { useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { callbackRoute } from '../router';
import { useConfig } from '../context/ConfigContext';

/**
 * Component to handle the WorkOS authentication callback
 * This component will be rendered at the callback URL path
 */
const AuthCallback = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate({ from: callbackRoute.id });
  const { code } = useSearch({ from: callbackRoute.id });
  const config = useConfig();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        if (!code) {
          setStatus('error');
          setError('No authentication code provided');
          return;
        }

        // The backend will handle the cookie setting, we just need to redirect
        // after the callback is complete
        setStatus('success');
        
        // Redirect to the main app after a short delay
        setTimeout(() => {
          navigate({ to: '/' });
        }, 1000);
      } catch (err) {
        console.error('Authentication error:', err);
        setStatus('error');
        setError('Failed to authenticate');
      }
    };

    // Only process the callback once the configuration is loaded
    if (config.isLoaded) {
      handleCallback();
    }
  }, [code, navigate, config.isLoaded]);

  if (status === 'loading') {
    return (
      <div className="auth-callback">
        <h2>Completing authentication...</h2>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="auth-callback error">
        <h2>Authentication Error</h2>
        <p>{error || 'An unknown error occurred'}</p>
        <button onClick={() => navigate({ to: '/login' })}>Try Again</button>
      </div>
    );
  }

  return (
    <div className="auth-callback success">
      <h2>Authentication Successful</h2>
      <p>Redirecting to application...</p>
    </div>
  );
};

export default AuthCallback;
