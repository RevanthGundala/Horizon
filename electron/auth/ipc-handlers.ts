// src/main/auth/ipcHandlers.ts (Example Path)
import { ipcMain } from 'electron';
import { AuthService, User } from './index'; // Import User type if needed elsewhere

// Initialize auth service (Assuming AuthService exports the singleton instance)
const auth = AuthService.getInstance();

// Define the structure of the state object sent to the renderer
interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
}

// Set up IPC handlers for authentication operations
export function setupAuthIpcHandlers(): void {
  console.log('[IPC Setup] Setting up Auth IPC Handlers...');

  // --- Initiate OAuth flow (Renamed from auth:initiate for clarity) ---
  ipcMain.handle('auth:login', async () => {
    await auth.initiateOAuth(); // No return value needed here
  });

  // --- Logout ---
  ipcMain.handle('auth:logout', async () => {
    console.log('[IPC Recv] auth:logout');
     try {
        await auth.logout(); // logout is now async
        console.log('[IPC Send] auth:logout - Success');
        return { success: true };
     } catch (error) {
        console.error('[IPC Error] auth:logout - Failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
     }
  });

  // --- Get Current Authentication Status (Replaces previous individual getters) ---
  ipcMain.handle('auth:get-status', (): AuthState => {
    console.log('[IPC Recv] auth:get-status');
    // Add a method to AuthService to get the combined state
    const status: AuthState = {
        isAuthenticated: auth.isAuthenticated(),
        isLoading: auth.getIsLoading(),
        user: auth.getUser()
    };
    console.log('[IPC Send] auth:get-status - Status:', { auth: status.isAuthenticated, loading: status.isLoading, userId: status.user?.id });
    return status;
  });

  // --- Check Auth Status (alias for auth:get-status) ---
  ipcMain.handle('auth:check-status', async (): Promise<boolean> => {
    console.log('[IPC Recv] auth:check-status');
    const result = await auth.checkAuthStatus();
    console.log('[IPC Send] auth:check-status -', result);
    return result;
  });

  // --- Get User ID (needed for onboarding/workspaces) ---
  ipcMain.handle('auth:get-user-id', () => {
    const user = auth.getUser();
    return user?.id || null;
  });

  // --- Removed Handlers ---
  // ipcMain.removeHandler('auth:is-authenticated'); // Clean up old handlers if needed
  // ipcMain.removeHandler('auth:get-user-id');

  console.log('[IPC Setup] Auth IPC Handlers Ready.');
}

// --- You might need to add this method to your AuthService class ---
/*
// Inside AuthService class:
public getAuthState(): AuthState {
    return {
        isAuthenticated: this.authenticated,
        isLoading: this.isLoading,
        user: this.currentUser
    };
}
*/
// Although the IPC handler above calls the individual getters, which also works.
// Adding getAuthState might be slightly cleaner if you prefer.