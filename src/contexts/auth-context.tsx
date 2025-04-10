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
    
    // Listen for authentication status changes from Electron main process
    if (window.electron) {
      console.log('Setting up auth status change listener');
      // First check if we're already authenticated with the Electron process
      window.electron.ipcRenderer.invoke('auth:is-authenticated')
        .then((isAuthenticated: boolean) => {
          console.log('Initial auth check with electron:', isAuthenticated);
          if (isAuthenticated) {
            return window.electron.ipcRenderer.invoke('auth:get-user-id');
          }
          return null;
        })
        .then((userId: string | null) => {
          if (userId) {
            console.log('Got user ID from electron:', userId);
            // Store the user ID for offline access
            localStorage.setItem('horizon-user-id', userId);
            // Refetch auth status
            queryClient.invalidateQueries({ queryKey: ['auth'] });
            // Navigate to home page if not already there
            navigate({ to: '/' });
          }
        })
        .catch(err => {
          console.error('Error checking auth status with electron:', err);
        });
      
      // Set up listener for future auth status changes
      window.electron.ipcRenderer.receive('auth:status-changed', (isAuthenticated: boolean) => {
        console.log('Received auth status change:', isAuthenticated);
        if (isAuthenticated) {
          // Get the user ID from electron
          window.electron.ipcRenderer.invoke('auth:get-user-id')
            .then((userId: string | null) => {
              if (userId) {
                console.log('Got user ID from electron after status change:', userId);
                // Store the user ID for offline access
                localStorage.setItem('horizon-user-id', userId);
              }
              // Refetch auth status
              queryClient.invalidateQueries({ queryKey: ['auth'] });
              // Navigate to home page
              navigate({ to: '/' });
            })
            .catch(err => {
              console.error('Error getting user ID after auth status change:', err);
              // Still try to refetch and navigate even if we can't get the user ID
              queryClient.invalidateQueries({ queryKey: ['auth'] });
              navigate({ to: '/' });
            });
        }
      });
    }
    
    // Clean up
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [navigate, queryClient]);
  
  const { data, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: async (): Promise<{ userId: string } | null> => {
      try {
        // For Electron app, check authentication status first using Electron IPC
        if (window.electron) {
          console.log('Checking authentication with Electron IPC');
          const isAuthenticated = await window.electron.ipcRenderer.invoke('auth:is-authenticated');
          
          if (isAuthenticated) {
            console.log('Authenticated with Electron');
            const userId = await window.electron.ipcRenderer.invoke('auth:get-user-id');
            if (userId) {
              console.log('Got user ID from Electron:', userId);
              // Store for offline use
              localStorage.setItem('horizon-user-id', userId);
              return { userId };
            }
          }
        }
        
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
        
        // Last resort: check localStorage even if we're online
        const storedUserId = localStorage.getItem('horizon-user-id');
        if (storedUserId) {
          console.log('Using stored user ID as last resort');
          return { userId: storedUserId };
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
