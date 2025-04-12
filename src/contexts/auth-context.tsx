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
  useCallback,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
// Assuming getUrl is correctly defined elsewhere
// import { getUrl } from '../utils/api';

// Define the shape of the context data
type AuthContextType = {
  isLoading: boolean; // Is the initial auth check running?
  logout: () => Promise<void>;
  userId: string | null; // The authenticated user's ID
  isOffline: boolean; // Is the application offline?
  isAuthenticated: boolean; // Is the user currently authenticated?
};

// Create the context
const AuthContext = createContext<AuthContextType | null>(null);

// Create the provider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  // Removed: const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Removed: const [offlineUserId, setOfflineUserId] = useState<string | null>(null); // Seems unused

  // --- Network Status Handling ---
  useEffect(() => {
      const handleOnline = () => {
          console.log('App is online');
          setIsOffline(false);
      };
      const handleOffline = () => {
          console.log('App is offline');
          setIsOffline(true);
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Clear potentially stale user ID from storage on initial load?
      // Consider if this is truly desired or if you need persistence across restarts
      // localStorage.removeItem('horizon-user-id');
      // sessionStorage.removeItem('horizon-user-id');

      return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
      };
  }, []);

  // --- IPC Listener for Authentication Success ---
  useEffect(() => {
    let unsubscribe: (() => void) | null = null; // Variable to hold the cleanup function

    const handleAuthSuccess = (userId: string) => { // Listener receives userId now
      console.log('Renderer received [auth-success] notification from main process for user:', userId);
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    };

    if (window.electron?.ipcRenderer?.on) {
      console.log('Renderer setting up [auth-success] listener using window.electron.ipcRenderer.on');
      
      // Explicitly type the listener and store the cleanup function
      const listener = (event: any, userId: string) => handleAuthSuccess(userId);
      window.electron.ipcRenderer.on('auth-success', listener);
      
      // Create an explicit unsubscribe function
      unsubscribe = () => {
        window.electron.ipcRenderer.removeListener('auth-success', listener);
      };
    } else {
      console.warn('AuthProvider: window.electron.ipcRenderer.on is not available. Cannot set up IPC listener.');
    } 

    // Cleanup: Call the unsubscribe function returned by window.electron.ipcRenderer.on
    return () => {
      if (unsubscribe) {
        console.log('Renderer cleaning up [auth-success] listener.');
        unsubscribe(); // Execute the cleanup function
      }
    };
  }, [queryClient]); // Dependency array
    // --- Debugging Helper ---
  const logAuthenticationState = useCallback(async () => {
      console.log('===== RENDERER: AUTHENTICATION DEBUG =====');
      if (!window.electron) {
          console.log('Renderer Debug: No electron window');
          return;
      }
      try {
          const authed = await window.electron.ipcRenderer.invoke('auth:is-authenticated');
          console.log('Renderer Debug: Is Authenticated (IPC):', authed);

          const userId = await window.electron.ipcRenderer.invoke('auth:get-user-id');
          console.log('Renderer Debug: User ID (IPC):', userId);

          if (userId) {
              const exists = await window.electron.ipcRenderer.invoke('db:user-exists', userId);
              console.log('Renderer Debug: User Exists in DB (IPC):', exists);
          }
      } catch (error) {
          console.error('Renderer Debug: Authentication state check failed:', error);
      } finally {
          console.log('===== RENDERER: END AUTHENTICATION DEBUG =====');
      }
  }, []);


  // --- Core Authentication Check Function (called by useQuery) ---
  const checkAuthStatus = useCallback(async (): Promise<{ userId: string } | null> => {
      console.log('Renderer: Running checkAuthStatus...');
      await logAuthenticationState(); // Log current state before checking

      if (!window.electron) {
          console.log('Renderer Check: No electron window, assuming logged out.');
          navigate({ to: '/login' }); // Navigate if check runs without electron context
          return null; // Indicate failure
      }

      try {
          // Check 1: Is the main process reporting authenticated state?
          const authed = await window.electron.ipcRenderer.invoke('auth:is-authenticated');
          console.log('Renderer Check: auth:is-authenticated result:', authed);
          if (!authed) {
              console.log('Renderer Check: Not authenticated via IPC, redirecting to login.');
              navigate({ to: '/login' });
              return null;
          }

          // Check 2: Can we get a User ID?
          const userId = await window.electron.ipcRenderer.invoke('auth:get-user-id');
          console.log('Renderer Check: auth:get-user-id result:', userId);
          if (!userId) {
              console.log('Renderer Check: No user ID found via IPC, redirecting to login.');
              // Maybe logout explicitly here if this happens?
              // await window.electron.ipcRenderer.invoke('auth:logout');
              navigate({ to: '/login' });
              return null;
          }

          // Check 3: Does the user data exist locally? (Optional but good for integrity)
          const exists = await window.electron.ipcRenderer.invoke('db:user-exists', userId);
          console.log('Renderer Check: db:user-exists result:', exists);

          if (!exists) {
              console.warn(`Renderer Check: User ${userId} authenticated but not found in local DB. Attempting sync...`);
              try {
                  const syncResult = await window.electron.ipcRenderer.invoke('sync:user', userId);
                  console.log('Renderer Check: User Sync Result:', syncResult);

                  // Re-check existence after sync attempt
                  const reCheckExists = await window.electron.ipcRenderer.invoke('db:user-exists', userId);
                  console.log('Renderer Check: User Exists After Sync:', reCheckExists);

                  if (!reCheckExists) {
                      console.error('Renderer Check: User still does not exist after sync, critical error. Logging out.');
                      // Force logout if sync fails to create user record
                      await window.electron.ipcRenderer.invoke('auth:logout');
                      navigate({ to: '/login' });
                      return null;
                  }
                  // If sync succeeded and user now exists, proceed.
              } catch (syncError) {
                  console.error('Renderer Check: Failed to sync user:', syncError);
                  // Decide recovery strategy: maybe allow proceeding, maybe force logout
                  await window.electron.ipcRenderer.invoke('auth:logout');
                  navigate({ to: '/login' });
                  return null;
              }
          }

          // If all checks pass:
          console.log(`Renderer Check: Authentication successful for user ${userId}.`);
          return { userId }; // Success, return user data

      } catch (error) {
          console.error('Renderer Check: Auth check failed with error:', error);
          // Attempt logout on unexpected errors during check
          try {
               if (window.electron) await window.electron.ipcRenderer.invoke('auth:logout');
          } catch (logoutErr) {
               console.error("Renderer Check: Failed to logout after auth check error:", logoutErr);
          }
          navigate({ to: '/login' });
          return null; // Indicate failure
      }
  }, [navigate, logAuthenticationState]); // Dependencies for useCallback


  // --- React Query for Auth State ---
  const { data, isLoading, isSuccess, isError } = useQuery({
      queryKey: ['auth'],
      queryFn: checkAuthStatus, // Use the detailed check function
      retry: false, // Don't retry on failure, checkAuthStatus handles navigation
      refetchOnWindowFocus: false, // Avoid unnecessary checks on focus
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 mins unless invalidated
      gcTime: 15 * 60 * 1000, // Keep data in cache longer
  });

  // --- Logout Function ---
  const logout = useCallback(async () => {
      console.log('Renderer: Initiating logout...');
      try {
          if (window.electron) {
              await window.electron.ipcRenderer.invoke('auth:logout');
              console.log('Renderer: Main process logout successful.');
          }
          // Clear local state if needed (main process should handle secure storage)
          // localStorage.removeItem('horizon-user-id'); // Likely redundant if main handles storage
      } catch (error) {
          console.error('Renderer: Logout failed:', error);
          // Still attempt to navigate even if IPC fails
      } finally {
          // Always clear query cache and navigate on logout attempt
          queryClient.invalidateQueries({ queryKey: ['auth'] }); // Clear auth state
          queryClient.removeQueries({ queryKey: ['auth']}); // Remove data completely
          navigate({ to: '/login', replace: true }); // Use replace to avoid back button issues
          console.log('Renderer: Navigated to login.');
      }
  }, [navigate, queryClient]);


  // --- Derived State ---
  // User ID comes directly from the successful query data
  const effectiveUserId = data?.userId ?? null;
  // User is authenticated if the query is successful and returned data
  const derivedIsAuthenticated = isSuccess && !!effectiveUserId;

  // Log derived state changes for debugging
  useEffect(() => {
      console.log(`Renderer Auth State Update: isLoading=${isLoading}, isSuccess=${isSuccess}, isError=${isError}, derivedIsAuthenticated=${derivedIsAuthenticated}, userId=${effectiveUserId}`);
      // Handle case where query fails after initial success (e.g., token expires and check fails)
      if(isError && !isLoading) {
           console.log("Renderer: Auth query returned error, ensuring navigation to login.");
           navigate({ to: '/login' });
      }
  }, [isLoading, isSuccess, isError, derivedIsAuthenticated, effectiveUserId, navigate]);


  // --- Provide Context Value ---
  return (
      <AuthContext.Provider value={{
          isLoading, // Let consumers know if the initial check is happening
          userId: effectiveUserId,
          logout,
          isOffline,
          isAuthenticated: derivedIsAuthenticated, // Use the state derived from the query
      }}>
          {children}
      </AuthContext.Provider>
  );
};

// --- Hook to use the context ---
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
      throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
