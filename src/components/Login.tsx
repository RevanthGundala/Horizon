import { useEffect } from 'react';
import { useConfig } from '../context/ConfigContext';

const Login = () => {
  const config = useConfig();

  useEffect(() => {
    // Only redirect once the configuration is loaded
    if (config.isLoaded) {
      // Use relative URL for API requests (will be proxied by Vite in development)
      window.location.href = '/auth/login';
    }
  }, [config.isLoaded]);

  return (
    <div className="login-page">
      <h2>Redirecting to login...</h2>
      <div className="loading-spinner"></div>
    </div>
  );
};

export default Login;
