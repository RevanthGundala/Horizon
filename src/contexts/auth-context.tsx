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
} from 'react';
import {useNavigate} from '@tanstack/react-router';
import { getUrl } from '../utils/api';

type AuthContextType = {
  isLoading: boolean;
  logout: () => Promise<void>;
  userId: string | null;
};

// Context
const AuthContext = createContext<AuthContextType | null>(null);

// Provider
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: async (): Promise<{ userId: string } | null> => {
      try {
        // Use the dedicated authentication check endpoint
        const authRes = await fetch(getUrl('/api/auth/me'), {
          credentials: 'include',
        });
        console.log('Auth check response status:', authRes.status);
        console.log('Auth check request headers:', { credentials: 'include' });
        
        if (!authRes.ok) {
          console.error('Authentication check failed:', authRes.status);
          navigate({ to: '/login' });
          return null;
        }
        
        const authData = await authRes.json();
        return authData;
      } catch (error) {
        console.error('Error checking authentication:', error);
        navigate({ to: '/login' });
        return null;
      }
    },
    retry: false,
  });

  const logout = async () => {
    try {
      // Call the logout endpoint
      await fetch(getUrl('/api/auth/logout'), {
        method: 'GET',
        credentials: 'include',
      });
      
      // Manually clear the cookie in the browser
      document.cookie = "wos-session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=None; Secure";
      
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

  return <AuthContext.Provider value={{ 
    isLoading, 
    userId: data?.userId || null,
    logout,
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
