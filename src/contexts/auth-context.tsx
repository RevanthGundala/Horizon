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
import { useNavigate } from '@tanstack/react-router'; // Assuming you use TanStack Router

// Define User interface (should match what main process /me handler returns)
interface User {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    profilePictureUrl?: string | null;
    // Add authenticated flag if backend sends it?
    authenticated?: boolean;
}

// Define Auth State structure (matching main process sender/handler)
interface AuthState {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: User | null;
}


// Define the shape of the context value provided to components
type AuthContextType = {
    isLoading: boolean; // Is the auth check running?
    logout: () => Promise<void>;
    userId: string | null; // The authenticated user's ID
    user: User | null; // Full user object
    isOffline: boolean; // Is the application offline?
    isAuthenticated: boolean; // Is the user currently authenticated?
    login: () => void; // Add login back if removed previously
};

// Create the context
const AuthContext = createContext<AuthContextType | null>(null);

// Create the provider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    // --- Network Status Handling ---
    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);


    // --- Core Authentication Check Function (called by useQuery) ---
    // This function asks the MAIN process for the current auth status
    const checkAuthStatus = useCallback(async (): Promise<User | null> => {
        console.log('Renderer: Running checkAuthStatus via IPC...');

        if (!window.electron?.ipcRenderer) { // Check if electron API is available
            console.log('Renderer Check: Electron IPC not available. Assuming logged out.');
            // Don't navigate here directly, let useQuery handle error state
            throw new Error("Electron context not available");
        }

        try {
            // *** FIX 1: Call the CORRECT IPC handler ***
            console.log("Renderer Check: Invoking 'auth:get-status'");
            const status: AuthState = await window.electron.ipcRenderer.invoke('auth:get-status');
            console.log("Renderer Check: Received status from main:", status);

            if (status?.isAuthenticated && status.user) {
                console.log(`Renderer Check: Authentication successful via IPC for user ${status.user.id}.`);
                return status.user; // Return the user object on success for useQuery data
            } else {
                console.log('Renderer Check: Not authenticated according to main process state.');
                return null; // Return null if not authenticated
            }
        } catch (error) {
            console.error('Renderer Check: Auth check failed with error:', error);
            // Throw error so useQuery knows it failed
            throw error;
        }
        // Removed the complex db checks here - main process AuthService handles state
    }, []);


    // --- React Query for Auth State ---
    const { data: user, isLoading, isSuccess, isError, error: queryError } = useQuery<User | null, Error>({
        queryKey: ['auth'], // Unique key for this query
        queryFn: checkAuthStatus, // Use the corrected check function
        retry: false, // Don't automatically retry on failure
        refetchOnWindowFocus: true, // Recheck when window regains focus (optional but good)
        staleTime: 1 * 60 * 1000, // Consider data fresh for 1 minute
        gcTime: 15 * 60 * 1000, // Cache data longer
    });

    // --- IPC Listener for STATUS UPDATES pushed from Main Process ---
    useEffect(() => {
        const handleAuthUpdate = (event: any, status: AuthState) => {
            console.log("Renderer: Received 'auth-status-changed' event:", status);
            // Update the React Query cache directly with the new status
            // This ensures the UI updates promptly without needing a full refetch
            queryClient.setQueryData(['auth'], status.user);
            // Force React Query to refetch for freshest state
            queryClient.invalidateQueries({ queryKey: ['auth'] });
        };

        let unsubscribe: (() => void) | null = null;
        if (window.electron?.ipcRenderer?.on) {
            console.log("Renderer setting up 'auth-status-changed' listener.");
            window.electron.ipcRenderer.on('auth-status-changed', handleAuthUpdate);
            // Store removeListener function for cleanup
            unsubscribe = () => {
                window.electron.ipcRenderer.removeListener('auth-status-changed', handleAuthUpdate);
            };
        } else {
             console.warn("AuthProvider: IPC listener not available.");
        }

        return () => {
            if (unsubscribe) {
                console.log("Renderer cleaning up 'auth-status-changed' listener.");
                unsubscribe();
            }
        };
    }, [queryClient]); // Re-run if queryClient changes (shouldn't often)


    // --- Logout Function ---
    const logout = useCallback(async () => {
        console.log('Renderer: Initiating logout via IPC...');
        try {
            if (window.electron?.ipcRenderer) {
                await window.electron.ipcRenderer.invoke('auth:logout');
                console.log('Renderer: Main process logout invoked successfully.');
            }
             // Update query state immediately to reflect logout
             queryClient.setQueryData(['auth'], null);
             // Optionally invalidate other user-specific queries
            queryClient.invalidateQueries(); // Invalidate all queries on logout
        } catch (error) {
            console.error('Renderer: Logout failed:', error);
        } finally {
            // Always navigate regardless of IPC success/failure
            console.log('Renderer: Navigating to login after logout attempt.');
            navigate({ to: '/login', replace: true });
        }
    }, [navigate, queryClient]);

     // --- Login Function (Ensure this exists) ---
     const login = useCallback(() => {
         console.log('Renderer: Initiating login via IPC...');
         if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.invoke('auth:login')
                .then(result => console.log("Renderer: Login invoked:", result))
                .catch(err => console.error("Renderer: Error invoking login:", err));
         } else {
             // Fallback for web? Or just error?
             console.error("Cannot initiate login: Electron context not available.");
         }
     }, []);


    // --- Derived State ---
    // User is authenticated if the query succeeded and returned a user object
    const derivedIsAuthenticated = isSuccess && !!user;

    // Log state changes for debugging
    useEffect(() => {
        console.log(`Renderer Auth State Update: isLoading=${isLoading}, isSuccess=${isSuccess}, isError=${isError}, derivedIsAuthenticated=${derivedIsAuthenticated}, userId=${user?.id ?? null}`);

        // Don't do anything while the query is running
        if (isLoading) {
            return;
        }

        // Condition 1: Query failed entirely
        if (isError) {
            console.log("Renderer: Auth query ended in error state, navigating to login.");
            // Avoid potential redirect loops if error is just missing electron context
            if (queryError?.message !== "Electron context not available") {
                 navigate({ to: '/login', replace: true }); // Use replace: true
            }
        }
        // *** Condition 2: Query succeeded BUT user is NOT authenticated ***
        else if (isSuccess && !derivedIsAuthenticated) {
             console.log("Renderer: Auth query succeeded but user is not authenticated, navigating to login.");
             navigate({ to: '/login', replace: true }); // Use replace: true
        }
        // Condition 3: Query succeeded AND user IS authenticated (isSuccess && derivedIsAuthenticated)
        // -> Do nothing, stay on the current page.
    }, [isLoading, isSuccess, isError, derivedIsAuthenticated, user, navigate, queryError]);


    // --- Provide Context Value ---
    return (
        <AuthContext.Provider value={{
            isLoading,
            userId: user?.id ?? null, // Provide userId from user object
            user: user ?? null,             // Provide full user object
            logout,
            login, // Make sure login is provided
            isOffline,
            isAuthenticated: derivedIsAuthenticated,
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

// Example loading spinner usage (add in your login or root component):
// import { useAuth } from 'src/contexts/auth-context';
// const { isLoading } = useAuth();
// if (isLoading) return <LoadingSpinner message="Logging you in..." />;
// (Replace LoadingSpinner with your actual spinner component)