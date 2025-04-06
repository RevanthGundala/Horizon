import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import React, {
  createContext,
  useContext,
  useMemo,
  ReactNode,
  useCallback,
} from 'react';

// Types
type User = {
  id: string;
  email: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
};

// Context
const AuthContext = createContext<AuthContextType | null>(null);

// Provider
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<User | null> => {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 401) {
          // Not logged in → trigger login
          await fetch('/api/auth/login', { method: 'POST' });
          return null;
        }
        throw new Error('Failed to fetch user');
      }
      const data = await res.json();
      return data.user;
    },
    retry: false,
  });

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user: data ?? null,
      isAuthenticated: !!data,
      isLoading,
      logout,
    }),
    [data, isLoading, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Hook to use it
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
