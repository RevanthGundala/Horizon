import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useConfig } from '../context/ConfigContext';

interface UserData {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePictureUrl?: string;
}

const UserProfile = () => {
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const config = useConfig();

  useEffect(() => {
    const fetchUserProfile = async () => {
      // Only fetch once the configuration is loaded
      if (!config.isLoaded) {
        return;
      }

      try {
        // Use relative URL for API requests (will be proxied by Vite in development)
        const response = await fetch('/user/profile', {
          method: 'GET',
          credentials: 'include', // Important: include cookies for authentication
        });

        // If we get redirected to login, handle it
        if (response.redirected) {
          navigate({ to: '/login' });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch user profile: ${response.status}`);
        }

        const data = await response.json();
        setUser(data.user);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [navigate, config.isLoaded]);

  const handleLogout = () => {
    // Use relative URL for API requests (will be proxied by Vite in development)
    window.location.href = '/auth/logout';
  };

  if (loading) {
    return (
      <div className="user-profile loading">
        <h2>Loading profile...</h2>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="user-profile error">
        <h2>Error Loading Profile</h2>
        <p>{error}</p>
        <button onClick={() => navigate({ to: '/login' })}>Login</button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="user-profile not-authenticated">
        <h2>Not Authenticated</h2>
        <button onClick={() => navigate({ to: '/login' })}>Login</button>
      </div>
    );
  }

  return (
    <div className="user-profile">
      <h2>User Profile</h2>
      {user.profilePictureUrl && (
        <img 
          src={user.profilePictureUrl} 
          alt={`${user.firstName} ${user.lastName}`} 
          className="profile-image"
        />
      )}
      <div className="profile-info">
        <p><strong>Name:</strong> {user.firstName} {user.lastName}</p>
        <p><strong>Email:</strong> {user.email}</p>
        <p><strong>ID:</strong> {user.id}</p>
      </div>
      <button onClick={handleLogout} className="logout-button">Logout</button>
    </div>
  );
};

export default UserProfile;
