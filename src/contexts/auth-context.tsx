import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from 'react';
import {useNavigate} from '@tanstack/react-router';
import { getUrl } from '../utils/api';

type AuthContextType = {
  isLoading: boolean;
  logout: () => Promise<void>;
  userId: string | null;
  isOffline: boolean;
};

// Context
const AuthContext = createContext<AuthContextType | null>(null);

// Provider
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(false);
  const [offlineUserId, setOfflineUserId] = useState<string | null>(null);
  
  // Check for network status
  useEffect(() => {
    // Check initial status
    setIsOffline(!navigator.onLine);
    
    // Set up event listeners for online/offline status
    const handleOnline = () => {
      console.log('App is online');
      setIsOffline(false);
    };
    
    const handleOffline = () => {
      console.log('App is offline');
      setIsOffline(true);
    };
    
    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Try to get the last known user ID from localStorage
    const storedUserId = localStorage.getItem('horizon-user-id');
    if (storedUserId) {
      setOfflineUserId(storedUserId);
    }
    
    // Clean up
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const { data, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: async (): Promise<{ userId: string } | null> => {
      try {
        // If we're offline, use the stored user ID
        if (!navigator.onLine) {
          console.log('Offline mode: using stored user ID');
          const storedUserId = localStorage.getItem('horizon-user-id');
          if (storedUserId) {
            return { userId: storedUserId };
          }
          return null;
        }
        
        // Use the dedicated authentication check endpoint
        const authRes = await fetch(getUrl('/api/auth/me'), {
          credentials: 'include',
        });
        console.log('Auth check response status:', authRes.status);
        
        if (!authRes.ok) {
          console.error('Authentication check failed:', authRes.status);
          
          // If we're offline but have a stored user ID, allow access
          if (!navigator.onLine && offlineUserId) {
            return { userId: offlineUserId };
          }
          
          navigate({ to: '/login' });
          return null;
        }
        
        const authData = await authRes.json();
        
        // Store the user ID for offline access
        if (authData && authData.userId) {
          localStorage.setItem('horizon-user-id', authData.userId);
        }
        
        return authData;
      } catch (error) {
        console.error('Error checking authentication:', error);
        
        // If we're offline but have a stored user ID, allow access
        if (!navigator.onLine && offlineUserId) {
          console.log('Offline mode: using stored user ID after error');
          return { userId: offlineUserId };
        }
        
        navigate({ to: '/login' });
        return null;
      }
    },
    retry: false,
    // Don't refetch on window focus when offline
    refetchOnWindowFocus: navigator.onLine,
  });

  const logout = async () => {
    try {
      // Remove the stored user ID
      localStorage.removeItem('horizon-user-id');
      setOfflineUserId(null);
      
      // If online, call the logout endpoint
      if (navigator.onLine) {
        await fetch(getUrl('/api/auth/logout'), {
          method: 'GET',
          credentials: 'include',
        });
        
        // Manually clear the cookie in the browser
        document.cookie = "wos-session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=None; Secure";
      }
      
      // Invalidate and reset the auth query cache
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      queryClient.setQueryData(['auth'], null);
      
      // Redirect to login page
      navigate({ to: '/login' });
    } catch (error) {
      console.error('Error logging out:', error);
      // Still try to redirect to login page even if there's an error
      navigate({ to: '/login' });
    }
  };

  // Determine the effective user ID (from online auth or offline storage)
  const effectiveUserId = data?.userId || (isOffline ? offlineUserId : null);

  return <AuthContext.Provider value={{ 
    isLoading, 
    userId: effectiveUserId,
    logout,
    isOffline,
  }}>{children}</AuthContext.Provider>;
};

// Hook to use it
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
