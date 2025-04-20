import { ipcMain } from 'electron';
import { SyncService } from './index'; // Adjust path to SyncService class
import { AuthService } from '../auth'; // Adjust path
import DatabaseService from '../data'; // Adjust path (needed for pending count)

// Initialize services required by these handlers
const syncService = SyncService.getInstance();
const authService = AuthService.getInstance(); // Needed for auth checks
const db = DatabaseService.getInstance(); // Needed for pending count

/**
 * Set up IPC handlers specifically for Sync Service operations.
 */
export function setupSyncIpcHandlers(): void {
     console.log("[IPC Setup] Registering Sync Handlers...");

     // Handle manual sync request from renderer
     ipcMain.handle('sync:request-sync', async () => {
         console.log("[IPC sync:request-sync] Received manual trigger.");
         // Perform checks before triggering
         if (!authService.isAuthenticated()) {
             return { success: false, error: 'Not Authenticated' };
         }
         if (!syncService.getOnlineStatus()) { // Use getter for current status
             // Optionally trigger a network check first?
             // await syncService.checkApiStatus();
             // if (!syncService.getOnlineStatus()) {
                 return { success: false, error: 'Offline' };
             // }
         }

         syncService.triggerSync(); // Trigger background sync (non-blocking)
         return { success: true, message: 'Sync triggered' };
     });

     // Handle network status request from renderer
     ipcMain.handle('sync:get-network-status', async () => {
         // Check status on demand and return it
         const isOnline = await syncService.checkApiStatus();
         return { isOnline: isOnline };
     });

     // Handle request for pending sync count (uses SyncLog)
     ipcMain.handle('db:get-pending-sync-count', () => {
         try {
             if (!authService.isAuthenticated()) return 0; // Don't count if logged out
             // Assumes getPendingSyncLogs exists on DatabaseService
             const logs = db.getPendingSyncLogs();
             // NOTE: Does NOT include pending chat messages here,
             // as that logic is now separate (in Chat module conceptually)
             return logs.length;
         } catch (error) {
             console.error("[IPC db:get-pending-sync-count] Error:", error);
             return 0;
         }
     });

     ipcMain.handle('sync:set-online-status', async (event, status) => {
         // You can do something with the status here, or just acknowledge
         console.log('[IPC] Set online status:', status);
         return { success: true };
     });

    console.log("[IPC Setup] Sync Handlers Registered.");
}