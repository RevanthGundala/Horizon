import { ipcMain } from 'electron';
import AuthService from './index';

// Initialize auth service
const auth = AuthService.getInstance();

// Set up IPC handlers for authentication operations
export function setupAuthIpcHandlers(): void {
  // Initiate OAuth flow
  ipcMain.handle('auth:login', async () => {
    await auth.initiateOAuth();
    return { success: true };
  });

  // Logout
  ipcMain.handle('auth:logout', () => {
    auth.logout();
    return { success: true };
  });

  // Check authentication status
  ipcMain.handle('auth:is-authenticated', () => {
    return auth.isAuthenticated();
  });

  // Get user ID
  ipcMain.handle('auth:get-user-id', () => {
    return auth.getUserId();
  });
}
