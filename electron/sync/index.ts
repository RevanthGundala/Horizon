import { BrowserWindow, WebContents } from 'electron';
import { AuthService } from '../auth'; // Adjust path
import DatabaseService, { Note, Block } from '../data'; // Adjust path
import crypto from 'crypto';
import { getMainWindowWebContents } from '../main';

// --- Configuration ---
const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
const SYNC_INTERVAL_MS = 30 * 1000; // 30 seconds

// ============================================================================
// Sync Service Class
// ============================================================================
export class SyncService {
    private static instance: SyncService;
    private db: DatabaseService;
    private auth: AuthService;
    private syncInterval: NodeJS.Timeout | null = null;
    private isInitialized = false;
    private isOnline = true; // Assume online initially
    private isSyncing = false; // Prevent concurrent sync runs

    private constructor() {
        this.db = DatabaseService.getInstance();
        this.auth = AuthService.getInstance();
        // IPC Handlers are set up externally
    }

    public static getInstance(): SyncService {
        if (!SyncService.instance) {
            SyncService.instance = new SyncService();
        }
        return SyncService.instance;
    }

    // --- Initialization & Shutdown ---
    public initialize(): void {
        if (this.isInitialized) return;
        console.log("[SyncService] Initializing...");
        this.isInitialized = true;
        this.checkApiStatus().then(online => {
            this.isOnline = online;
            if (this.isOnline && this.auth.isAuthenticated()) {
                console.log("[SyncService] Triggering initial sync on startup.");
                this.triggerSync();
            }
        });
        this.syncInterval = setInterval(() => {
            this.checkApiStatus().then(online => {
                this.isOnline = online;
                if (this.isOnline && this.auth.isAuthenticated()) {
                     this.triggerSync();
                }
            });
        }, SYNC_INTERVAL_MS);
    }

    public shutdown(): void {
        if (this.syncInterval) {
            console.log("[SyncService] Stopping periodic sync.");
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isInitialized = false;
    }

    // --- Public Status & Trigger ---
    public getOnlineStatus(): boolean { return this.isOnline; }

    public async checkApiStatus(): Promise<boolean> {
        // (Keep implementation from previous example - fetch /api/status)
         try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(`${API_URL}/api/status`, { method: 'GET', signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            this.isOnline = response.ok;
            if(!response.ok) console.warn(`[SyncService] API status check failed: ${response.status}`);
            return this.isOnline;
        } catch (error: any) {
            console.warn('[SyncService] API status check error:', error.name === 'AbortError' ? 'Timeout' : error.message);
            this.isOnline = false;
            return false;
        }
    }

    public triggerSync(): void {
        if (this.isSyncing) return; // console.log("[SyncService] Sync already in progress..."); return;
        if (!this.isOnline) return; // console.log("[SyncService] Trigger skipped: Offline."); return;
        if (!this.auth.isAuthenticated()) return; // console.log("[SyncService] Trigger skipped: Not Authenticated."); return;

        this.isSyncing = true;
        console.log("[SyncService] Starting sync run...");
        this._syncCore()
            .then(result => {
                console.log(`[SyncService] Sync run finished. Success: ${result.success}. Error: ${result.error || 'None'}`);
                // Notify renderer
                const mainWindow = getMainWindowWebContents();
                if (mainWindow) mainWindow.send('sync:status-update', result);
            })
            .catch(error => {
                console.error("[SyncService] Core sync run promise failed:", error);
                 const mainWindow = getMainWindowWebContents();
                 if (mainWindow) mainWindow.send('sync:status-update', { success: false, error: `Sync Exception: ${error.message}`});
            })
            .finally(() => { this.isSyncing = false; });
    }

    // --- Core Sync Logic ---
    private async _syncCore(): Promise<{ success: boolean; error?: string }> {
         if (!this.isOnline || !this.auth.isAuthenticated()) return { success: false, error: 'Offline or Not Authenticated' };

         let overallSuccess = true;
         let accumulatedErrors: string[] = [];

         try {
           // --- MODIFIED AUTHENTICATION CHECK ---
// Check the current authentication state known by AuthService
const authService = AuthService.getInstance();
if (!authService.isAuthenticated()) {
    // Handle the case where the Electron app knows the user isn't authenticated
    console.error("Not authenticated according to AuthService state. Aborting chat request.");
    throw new Error("Not authenticated for streaming");
} 

             // Step 1: Push local changes (SyncLog table)
             try {
                 await this.pushLocalChanges();
             } catch (pushError: any) {
                  console.error("[SyncService Core] Push changes failed:", pushError);
                  overallSuccess = false; // Decide if push failure halts the sync
                  accumulatedErrors.push(`Push Failed: ${pushError.message}`);
             }

             // Step 2: Check status vs server hashes (only if push didn't fail critically?)
             if (overallSuccess) {
                 try {
                     const workspaceHashes = await this.getWorkspaceHashes(); // Now uses workspaces table
                     if (Object.keys(workspaceHashes).length > 0) {
                         const statusResponse = await fetch(`${API_URL}/api/sync/status`, {
                             method: 'POST',
                             headers: { 'Content-Type': 'application/json' },
                             body: JSON.stringify({ workspace_hashes: workspaceHashes }),
                             signal: AbortSignal.timeout(15000),
                             credentials: 'include'
                         });
                         if (!statusResponse.ok) throw new Error(`Sync status failed (${statusResponse.status})`);
                         const statusResult = await statusResponse.json();

                         // Step 3: Pull updates for mismatches
                         if (statusResult.mismatches?.length > 0) {
                             await this.handleMismatches(statusResult.mismatches);
                         }
                     } else {
                         console.log('[SyncService Core] No local workspaces to check status.');
                         // Pull all workspaces if none exist locally?
                         // await this.pullAllWorkspaces(sessionCookie); // Add this method if needed
                     }
                 } catch (statusPullError: any) {
                     console.error("[SyncService Core] Status/Pull phase failed:", statusPullError);
                     overallSuccess = false;
                     accumulatedErrors.push(`Status/Pull Failed: ${statusPullError.message}`);
                 }
             }

             return { success: overallSuccess, error: accumulatedErrors.join('; ') || undefined };

         } catch (error: any) {
             console.error('[SyncService Core] Unhandled error:', error);
             return { success: false, error: `Unhandled Sync Error: ${String(error.message || error)}` };
         }
     }

    // --- Sync Sub-routines ---

    /** Pushes pending changes from the local SyncLog table */
    private async pushLocalChanges(): Promise<void> {
        // --- Logic remains the same as before ---
        // Fetches from db.getPendingSyncLogs()
        // Maps logs to 'changes' array
        // POSTs to /api/sync/push with Cookie header
        // Updates log status in DB via db.updateSyncLogStatus()
        // Handles conflicts returned by the server
        // Remember to ensure db.markEntityAsConflict exists if using that part.
        const syncLogs = this.db.getPendingSyncLogs();
        if (syncLogs.length === 0) return;
        console.log(`[SyncService Push] Found ${syncLogs.length} pending changes.`);
        const changes = syncLogs.map(log => { /* ... map log ... */ }).filter(Boolean);
        if (changes.length === 0) return;

        try {
            const response = await fetch(`${API_URL}/api/sync/push`, { credentials: 'include' });
            if (!response.ok) throw new Error(`Failed to push changes: ${response.status} ${response.statusText}`);
            const result = await response.json();
            for (const log of syncLogs) { /* ... update log status based on result.conflicts ... */ }
            // ... conflict handling ...
        } catch (error: any) { /* ... error handling ... */ }
    }

    /** Handles mismatches by calling pullWorkspaceData for each */
    private async handleMismatches(
        mismatches: Array<{ workspace_id: string }>, // Simplified mismatch type
    ): Promise<void> {
        console.log(`[SyncService Pull] Handling ${mismatches.length} workspace mismatches.`);
        for (const mismatch of mismatches) {
            try { await this.pullWorkspaceData(mismatch.workspace_id); }
            catch (error) { /* ... log error, continue with others ... */ }
        }
    }

     /** Pulls and updates local data for a specific workspace */
    private async pullWorkspaceData(workspaceId: string): Promise<void> {
        console.log(`[SyncService Pull] Pulling workspace ${workspaceId}...`);
        try {
            const response = await fetch(`${API_URL}/api/sync/pull`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspace_id: workspaceId, include_blocks: true }),
                signal: AbortSignal.timeout(60000)
            });
            if (!response.ok) throw new Error(`Failed to pull workspace: ${response.status} ${response.statusText}`);
            const data = await response.json();
            const { workspace, notes, blocks } = data; // Includes actual workspace record now
            if (!workspace || !notes || !blocks) throw new Error('Failed to pull workspace data');

            // --- Apply changes locally using DatabaseService methods ---
            const transaction = this.db.getDb().transaction(() => {
                // *** PROCESS WORKSPACE ***
                const localWorkspace = this.db.getWorkspace(workspace.id); // Assumes exists
                if (!localWorkspace) {
                    this.db.createWorkspaceFromServer(workspace, true); // true = skip sync log
                } else if (localWorkspace.sync_status !== 'pending') {
                     // Compare timestamps if necessary before updating
                     const serverTs = new Date(workspace.updated_at || 0).getTime();
                     const localTs = new Date(localWorkspace.updated_at || 0).getTime();
                     if (serverTs > localTs) {
                        this.db.updateWorkspaceFromServer(workspace.id, workspace, true);
                     }
                } else {
                     console.log(`[Sync Pull] Skipping local pending workspace ${workspace.id}`);
                }

                // Process notes (compare timestamps, handle pending, use *FromServer)
                // ... (detailed logic as before) ...

                // Process blocks (compare timestamps, handle pending, use *FromServer)
                // ... (detailed logic as before) ...
            });

            transaction();
            console.log(`[SyncService Pull] Successfully processed workspace ${workspaceId}`);
        } catch (error) { /* ... error handling ... */ throw error; }
    }


    // --- Workspace Hashing Logic (Updated) ---

    /** Gets hashes for all workspaces based on the workspaces table */
    private async getWorkspaceHashes(): Promise<Record<string, string>> {
        // *** Fetch from WORKSPACES table now ***
        const workspaces = this.db.getWorkspaces(); // Assumes this method exists
        console.log(`[SyncService Hashes] Found ${workspaces.length} workspaces.`);

        const hashes: Record<string, string> = {};
        for (const ws of workspaces) {
            try {
                // Pass DatabaseService instance if needed, or ensure compute hash has access
                const hash = this.computeWorkspaceHash(ws.id); // Use workspace ID
                if (hash) hashes[ws.id] = hash;
            } catch (hashError) {
                console.error(`[SyncService Hashes] Error computing hash for workspace ${ws.id}:`, hashError);
            }
        }
        return hashes;
    }

    /** Computes hash for a specific workspace ID */
    // Ensure this method and its helpers (getAllChildNotes, getBlocksForNotes)
    // exist either here or (preferably) in DatabaseService and work correctly
    // with your local SQLite structure.
    private computeWorkspaceHash(workspaceId: string): string {
        const workspace = this.db.getWorkspace(workspaceId); // Get workspace record
        if (!workspace) {
             console.warn(`[SyncService Hashes] Workspace ${workspaceId} not found for hashing.`);
             return '';
        }

        // Get all notes directly belonging to this workspace
        const directNotes = this.db.getNotes(workspaceId, undefined); // Notes where workspace_id = wsId and parent_id IS NULL? or just workspace_id = wsId? --> Assume all notes in workspace needed.
        const allNotesInWorkspace = this.getAllNotesInWorkspace(workspaceId); // Get ALL notes (direct & nested)
        const allNoteIds = allNotesInWorkspace.map(n => n.id);
        const allBlocksInWorkspace = allNoteIds.length > 0 ? this.db.getBlocksForNotes(allNoteIds) : []; // Needs getBlocksForNotes

        const notesMap = new Map(allNotesInWorkspace.map((n: Note) => [n.id, n]));
        const blocksByNoteId = new Map<string, Block[]>();
        allBlocksInWorkspace.forEach((b: Block) => {
            const list = blocksByNoteId.get(b.note_id) || [];
            list.push(b);
            blocksByNoteId.set(b.note_id, list);
        });

        const computeHashRecursive = (noteId: string): string => {
            const note = notesMap.get(noteId);
            if (!note) return '';
            const blocks = (blocksByNoteId.get(noteId) || []).sort((a, b) => a.order_index - b.order_index);
            const blockHashes = blocks.map(b => crypto.createHash('sha256').update(`${b.id}|${b.type}|${b.content}|${b.updated_at}`).digest('hex')).join('');
            // Find children by parent_id link
            const childNotes = allNotesInWorkspace.filter(n => n.parent_id === noteId).sort((a, b) => (a.title || '').localeCompare(b.title || '')); // Ensure consistent order
            const childHashes = childNotes.map(child => computeHashRecursive(child.id)).join('');
            const noteData = `${note.id}|${note.title}|${note.updated_at}|${blockHashes}|${childHashes}`;
            return crypto.createHash('sha256').update(noteData).digest('hex');
        };

        // Calculate hash based on direct child notes of the workspace
        const directNoteHashes = directNotes
            .sort((a,b) => (a.title || '').localeCompare(b.title || '')) // Consistent order
            .map(note => computeHashRecursive(note.id)) // Hash each top-level note tree
            .join('');

        // Combine workspace data with the aggregated hash of its contents
        const workspaceData = `${workspace.id}|${workspace.name}|${workspace.updated_at}|${directNoteHashes}`;
        return crypto.createHash('sha256').update(workspaceData).digest('hex');
    }

    // Helper to get all notes (direct and nested) within a workspace - move to DatabaseService
    private getAllNotesInWorkspace(workspaceId: string): Note[] {
       // This needs an efficient query in DatabaseService, possibly recursive CTE in SQLite if supported,
       // or multiple queries starting with direct notes and fetching descendants.
       // Placeholder implementation:
       let allNotes: Note[] = [];
       const directNotes = this.db.getNotes(workspaceId, undefined); // Assuming notes with workspace_id
       const noteQueue = [...directNotes];
       const visited = new Set<string>();
       while(noteQueue.length > 0) {
            const currentNote = noteQueue.shift();
            if (!currentNote || visited.has(currentNote.id)) continue;
            visited.add(currentNote.id);
            allNotes.push(currentNote);
            const children = this.db.getNotes(undefined, currentNote.id); // Assuming getNotes(wsId, parentId)
            noteQueue.push(...children);
       }
       return allNotes;
    }

    // Helper to get blocks for multiple notes - move to DatabaseService
    // private getBlocksForNotes(noteIds: string[]): Block[] {
    //     return this.db.getBlocksForNotes(noteIds); // Assumes this method exists
    // }

    // --- REMOVED ---
    // Chat processing logic (_processPendingChatMessages)
    // User sync logic (syncUser)
}