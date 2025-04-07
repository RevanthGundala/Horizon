import React from 'react';
import '../styles/Login.css';
import { getUrl } from '../utils/api';

const Login: React.FC = () => {
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
          
          <a 
            className="login-button"
            href={getUrl('/api/auth/login')}
            style={{ display: 'inline-block', textDecoration: 'none', textAlign: 'center' }}
          >
            Sign in with WorkOS
          </a>
          
          <div className="login-footer">
            <p>Don't have an account? Contact your administrator.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
