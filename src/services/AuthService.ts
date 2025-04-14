import { isElectron, ipcCall } from '../utils/helpers';
// Auth service interface
export interface AuthService {
  login(): Promise<{ success: boolean; error?: string }>;
  logout(): Promise<{ success: boolean }>;
  isAuthenticated(): Promise<boolean>;
  getUserId(): Promise<string | null>;
}

// Create auth service instance using IPC to communicate with Electron main process
export const auth: AuthService = {
  login: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - redirecting to login page');
      window.location.href = `${import.meta.env.VITE_API_URL}/api/auth/login?from=web`;
      return { success: true };
    }
    
    try {
      return await ipcCall<{ success: boolean; error?: string }>('auth:login');
    } catch (error) {
      console.error('Error during login:', error);
      return { success: false, error: String(error) };
    }
  },

  logout: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock logout');
      clearAuthState();
      return { success: true };
    }
    
    try {
      await ipcCall('auth:logout');
      clearAuthState();
      return { success: true };
    } catch (error) {
      console.error('Error during logout:', error);
      return { success: false };
    }
  },

  isAuthenticated: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - checking local auth state');
      const state = getAuthState();
      return state.isAuthenticated;
    }
    
    try {
      return await ipcCall<boolean>('auth:check-status');
    } catch (error) {
      console.error('Error checking authentication status:', error);
      return false;
    }
  },

  getUserId: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - getting user ID from local state');
      const state = getAuthState();
      return state.userId || null;
    }
    
    try {
      return await ipcCall<string | null>('auth:get-user-id');
    } catch (error) {
      console.error('Error getting user ID:', error);
      return null;
    }
  }
};

// Create a local storage key for storing authentication state in the renderer
// This is just for UI purposes and doesn't affect actual authentication
const AUTH_STATE_KEY = 'horizon_auth_state';

// Helper functions for managing auth state in the renderer
export const setAuthState = (isAuthenticated: boolean, userId?: string): void => {
  localStorage.setItem(AUTH_STATE_KEY, JSON.stringify({ 
    isAuthenticated, 
    userId,
    lastUpdated: new Date().toISOString()
  }));
};

export const getAuthState = (): { isAuthenticated: boolean; userId?: string } => {
  const stateStr = localStorage.getItem(AUTH_STATE_KEY);
  if (!stateStr) {
    return { isAuthenticated: false };
  }
  
  try {
    return JSON.parse(stateStr);
  } catch (error) {
    console.error('Error parsing auth state:', error);
    return { isAuthenticated: false };
  }
};

export const clearAuthState = (): void => {
  localStorage.removeItem(AUTH_STATE_KEY);
};

// Initialize auth state from main process
export const initAuthState = async (): Promise<void> => {
  if (!isElectron()) {
    return;
  }
  
  try {
    const isAuthenticated = await auth.isAuthenticated();
    if (isAuthenticated) {
      const userId = await auth.getUserId();
      setAuthState(true, userId || undefined);
    } else {
      clearAuthState();
    }
  } catch (error) {
    console.error('Error initializing auth state:', error);
    clearAuthState();
  }
};
