import { ipcMain } from 'electron';
import DatabaseService, { Block, Note, SyncLog, Workspace } from './index';
import AuthService from '../auth';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Define the API base URL
const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';

// Types
export interface NoteWithChildren extends Note {
  children: NoteWithChildren[];
}

interface SyncResult {
  status: 'completed' | 'up-to-date' | 'failed';
  updated?: number;
  deleted?: number;
  error?: string;
}

class SyncService {
  private db: DatabaseService;
  private auth: AuthService;
  private syncInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private isOnline = false;
  private static instance: SyncService;


  private constructor() {
    this.db = DatabaseService.getInstance();
    this.auth = AuthService.getInstance();
    this.setupIpcHandlers();
  }

  public static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  public initialize(): void {
    if (this.isInitialized) return;
    
    // Check network status initially
    this.checkNetworkStatus();
    
    // Set up periodic sync (every 30 seconds)
    this.syncInterval = setInterval(() => {
      this.checkNetworkStatus();
      if (this.isOnline && this.auth.isAuthenticated()) {
        this.syncWithServer();
      }
    }, 30000);
    
    this.isInitialized = true;
    
    // Sync on app start if online and authenticated
    if (this.isOnline && this.auth.isAuthenticated()) {
      this.syncWithServer();
    }
  }

  private setupIpcHandlers(): void {
    // Handle manual sync request from renderer
    ipcMain.handle('sync:request-sync', async () => {
      await this.checkNetworkStatus();
      if (this.isOnline) {
        return await this.syncWithServer();
      } else {
        return { success: false, error: 'Offline' };
      }
    });
    
    // Handle network status request from renderer
    ipcMain.handle('sync:get-network-status', () => {
      return { isOnline: this.isOnline };
    });
    
    // Handle online status change from renderer
    ipcMain.handle('sync:set-online-status', (_event, isOnline: boolean) => {
      this.isOnline = isOnline;
      
      // Trigger sync if we just came online
      if (isOnline) {
        this.syncWithServer();
      }
      
      return { success: true };
    });

    // Add sync:user IPC handler with proper validation and logging
    ipcMain.handle('sync:user', async (event, userId: string) => {
      console.log(`[IPC] Attempting to sync user: ${userId}`);
      
      // Basic validation
      if (!userId) {
        console.error('[IPC] Invalid userId for sync');
        return false;
      }

      try {
        const syncResult = await this.syncUser(userId);
        console.log(`[IPC] User sync result for ${userId}:`, syncResult);
        return syncResult;
      } catch (error) {
        console.error(`[IPC] Error syncing user ${userId}:`, error);
        return false;
      }
    });
  }

  public async checkNetworkStatus(): Promise<boolean> {
    try {
      // Try to fetch a small resource from the API with a short timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch(`${API_URL}/api/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      this.isOnline = response.ok;
      return this.isOnline;
    } catch (error) {
      this.isOnline = false;
      console.log('Network check failed, device appears to be offline:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  public async syncWithServer(): Promise<{ success: boolean; error?: string }> {
    if (!this.isOnline) return { success: false, error: 'Offline' };
    
    try {
      console.log('Starting sync with server...');
      
      // First check if the API is available with a short timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        const statusCheckResponse = await fetch(`${API_URL}/api/status`, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!statusCheckResponse.ok) {
          console.log(`API status check failed: ${statusCheckResponse.status} ${statusCheckResponse.statusText}`);
          return { success: false, error: `API unavailable: ${statusCheckResponse.status} ${statusCheckResponse.statusText}` };
        }
        
        console.log('API status check successful');
      } catch (error) {
        console.log('API status check error:', error);
        this.isOnline = false; // Set the app to offline mode when API is unreachable
        return { success: false, error: `API connection error: ${error instanceof Error ? error.message : String(error)}` };
      }
      
      // Step 1: Check status - get mismatches (like git status)
      const workspaceHashes = await this.getWorkspaceHashes();
      console.log('Got workspace hashes:', Object.keys(workspaceHashes).length > 0 ? Object.keys(workspaceHashes).join(', ') : 'none');
      
      // Get the session cookie
      const sessionCookie = this.auth.getAccessToken();
      if (!sessionCookie) {
        console.log('No authentication token available for sync');
        return { success: false, error: 'Not authenticated' };
      }
      
      console.log(`Sending sync status request to ${API_URL}/api/sync/status`);
      
      // Skip sync if we don't have any workspaces
      if (Object.keys(workspaceHashes).length === 0) {
        console.log('No workspaces to sync, skipping');
        return { success: true };
      }
     
      const statusResponse = await fetch(`${API_URL}/api/sync/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${sessionCookie}`,
        },
        body: JSON.stringify({ workspace_hashes: workspaceHashes })
      });

      if (!statusResponse.ok) throw new Error(`Sync status failed: ${statusResponse.statusText}`);
      
      const result = await statusResponse.json();
      
      if (result.mismatches?.length > 0) {
        // Step 2: Handle mismatches by pulling updates (like git pull)
        await this.handleMismatches(result.mismatches);
      }
      
      // Step 3: Process sync logs to push local changes (like git push)
      await this.pushLocalChanges();
      
      return { success: true };
    } catch (error: any) {
      console.error('Sync error:', error);
      return { success: false, error: String(error) };
    }
  }
  
  private async pushLocalChanges(): Promise<void> {
    // Get pending sync logs
    const syncLogs = this.db.getPendingSyncLogs();
    if (syncLogs.length === 0) return;
    
    // Group sync logs by entity type for efficient processing
    const changes = syncLogs.map(log => ({
      entity_type: log.entity_type as 'workspace' | 'note' | 'block',
      action: log.action as 'create' | 'update' | 'delete',
      entity_id: log.entity_id,
      data: log.payload ? JSON.parse(log.payload) : undefined,
      client_updated_at: log.created_at
    }));
    
    try {
      // Get the session cookie
      const sessionCookie = this.auth.getAccessToken();
      if (!sessionCookie) {
        throw new Error('No authentication token available');
      }
      
      const response = await fetch(`${API_URL}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${sessionCookie}`
        },
        body: JSON.stringify({ changes, sync_token: uuidv4() })
      });
      
      if (!response.ok) throw new Error(`Push failed: ${response.statusText}`);
      
      const result = await response.json();
      
      // Mark sync logs as processed
      for (const log of syncLogs) {
        this.db.updateSyncLogStatus(log.id, 'success');
      }
      
      // Handle any conflicts returned by server
      if (result.conflicts && result.conflicts.length > 0) {
        // This would be where you'd implement conflict resolution
        console.log('Conflicts detected:', result.conflicts);
      }
    } catch (error) {
      console.error('Error pushing changes:', error);
    }
  }

  private async getWorkspaceHashes(): Promise<Record<string, string>> {
    // Get all top-level pages from notes table
    const stmt = this.db.getDb().prepare(`
      SELECT id FROM notes 
      WHERE parent_id IS NULL 
      ORDER BY updated_at DESC
    `);
    const workspaces = stmt.all();
    
    console.log(`Found ${workspaces.length} potential workspaces for sync`);
    
    const hashes: Record<string, string> = {};
    
    for (const ws of workspaces) {
      const workspaceId = (ws as unknown as { id: string }).id;
      const hash = await this.computeWorkspaceHash(workspaceId);
      hashes[workspaceId] = hash;
    }
    
    return hashes;
  }

  public computeWorkspaceHash(workspaceId: string): string {
    // 1. Get workspace metadata (workspace is a top-level note in our implementation)
    const workspaceNote = this.db.getNote(workspaceId);
    if (!workspaceNote) {
      console.log(`No workspace found with ID: ${workspaceId}`);
      return '';
    }
    
    // 2. Get all notes in workspace (including hierarchy)
    const notes = this.db.getNotes(undefined, workspaceId); // Get notes with this parent ID
    
    // 3. Build note tree with hierarchy
    const noteTree = this.buildNoteTree(notes);
    
    // 4. Compute note hashes recursively
    const computeNoteHash = (note: NoteWithChildren): string => {
      // Get all blocks for this note
      const blocks = this.db.getBlocks(note.id);
      
      // Compute block hashes
      const blockHashes = blocks
        .map(block => {
          const blockData = `${block.id}|${block.type}|${block.content}|${block.updated_at}`;
          return crypto.createHash('sha256').update(blockData).digest('hex');
        })
        .join('');
      
      // Compute child note hashes
      const childHashes = note.children
        .map(computeNoteHash)
        .join('');
      
      // Combine with note data and hash
      const noteData = `${note.id}|${note.title}|${note.updated_at}|${blockHashes}|${childHashes}`;
      return crypto.createHash('sha256').update(noteData).digest('hex');
    };
    
    // 5. Compute workspace hash
    const noteHashes = noteTree.map(computeNoteHash).join('');
    const workspaceData = `${workspaceNote.id}|${workspaceNote.title}|${workspaceNote.updated_at}|${noteHashes}`;
    
    return crypto.createHash('sha256').update(workspaceData).digest('hex');
  }

  private buildNoteTree(notes: Note[]): NoteWithChildren[] {
    const noteMap = new Map<string, NoteWithChildren>();
    
    // Create map of all notes
    notes.forEach(note => {
      noteMap.set(note.id, { ...note, children: [] });
    });
    
    // Build hierarchy
    const roots: NoteWithChildren[] = [];
    noteMap.forEach(note => {
      if (note.parent_id && noteMap.has(note.parent_id)) {
        noteMap.get(note.parent_id)!.children.push(note);
      } else {
        roots.push(note);
      }
    });
    
    return roots;
  }

  private async handleMismatches(mismatches: Array<{
    workspace_id: string;
    required_entities: Array<'note' | 'block' | 'workspace'>;
  }>): Promise<void> {
    for (const mismatch of mismatches) {
      // Use the new pull endpoint to get all data at once
      await this.pullWorkspaceData(mismatch.workspace_id);
    }
  }
  
  private async pullWorkspaceData(workspaceId: string): Promise<void> {
    try {
      console.log(`Pulling data for workspace ${workspaceId}`);
      // Get the session cookie
      const sessionCookie = this.auth.getAccessToken();
      if (!sessionCookie) {
        throw new Error('No authentication token available');
      }
      
      const response = await fetch(`${API_URL}/api/sync/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${sessionCookie}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId, include_blocks: true })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull workspace data: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Extract the data
      const { workspace, notes, blocks, hash } = data;
      
      // Begin transaction
      this.db.getDb().exec('BEGIN TRANSACTION');
      
      try {
        // Process workspace
        if (workspace) {
          const localWorkspace = this.db.getWorkspace(workspace.id);
          if (!localWorkspace) {
            // New workspace from server
            this.db.createWorkspaceFromServer(workspace, false); // Skip sync log creation
          } else if (localWorkspace.sync_status !== 'pending') {
            // Update existing workspace if not pending sync
            this.db.updateWorkspaceFromServer(workspace.id, workspace, false); // Skip sync log creation
          }
        }
        
        // Process notes
        const localNotes = this.db.getNotes(workspaceId);
        const localNoteMap = new Map(localNotes.map(note => [note.id, note]));
        const serverNoteIds = new Set();
        
        for (const note of notes) {
          serverNoteIds.add(note.id);
          const localNote = localNoteMap.get(note.id);
          
          if (!localNote) {
            // New note from server
            this.db.createNoteFromServer(note, false); // Skip sync log creation
          } else if (localNote.sync_status !== 'pending') {
            // Update existing note if not pending sync
            const serverTimestamp = new Date(note.updated_at).getTime();
            const localTimestamp = new Date(localNote.updated_at).getTime();
            
            if (serverTimestamp > localTimestamp) {
              this.db.updateNoteFromServer(note.id, note, false); // Skip sync log creation
            }
          }
        }
        
        // Delete notes that exist locally but not on server
        for (const [id, note] of localNoteMap.entries()) {
          if (!serverNoteIds.has(id) && note.sync_status !== 'pending') {
            this.db.deleteNoteFromServer(id, false); // Skip sync log creation
          }
        }
        
        // Process blocks
        const localBlocks = this.db.getBlocksForWorkspace(workspaceId);
        const localBlockMap = new Map(localBlocks.map(block => [block.id, block]));
        const serverBlockIds = new Set();
        
        for (const block of blocks) {
          serverBlockIds.add(block.id);
          const localBlock = localBlockMap.get(block.id);
          
          if (!localBlock) {
            // New block from server
            this.db.createBlockFromServer(block, false); // Skip sync log creation
          } else if (localBlock.sync_status !== 'pending') {
            // Update existing block if not pending sync
            const serverTimestamp = new Date(block.updated_at).getTime();
            const localTimestamp = new Date(localBlock.updated_at).getTime();
            
            if (serverTimestamp > localTimestamp) {
              this.db.updateBlockFromServer(block.id, block, false); // Skip sync log creation
            }
          }
        }
        
        // Delete blocks that exist locally but not on server
        for (const [id, block] of localBlockMap.entries()) {
          if (!serverBlockIds.has(id) && block.sync_status !== 'pending') {
            this.db.deleteBlockFromServer(id, false); // Skip sync log creation
          }
        }
        
        // Commit transaction
        this.db.getDb().exec('COMMIT');
        console.log(`Successfully pulled and processed workspace ${workspaceId}`);
        
      } catch (error) {
        // Rollback on error
        this.db.getDb().exec('ROLLBACK');
        console.error('Error processing pulled data:', error);
        throw error;
      }
    } catch (error) {
      console.error(`Error pulling workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  public async syncUser(userId: string): Promise<boolean> {
    // userId parameter can still be useful for logging, but isn't needed for the URL path anymore
    console.log(`[Client SyncUser] Syncing current user (ID from auth: ${userId})`);
    try {
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.error('[Client SyncUser] No access token available.');
        return false;
      }
  
      // *** CHANGE THE URL TO THE NEW ENDPOINT ***
      // const requestUrl = `${API_URL}/api/users/${userId}`; // OLD URL
      const requestUrl = `${API_URL}/api/users/me`; // NEW URL
  
      const requestHeaders = {
          'Content-Type': 'application/json',
          // Keep using the Cookie header as required by withAuth
          'Cookie': `wos-session=${accessToken}`
      };
  
      console.log(`[Client SyncUser] Fetching ${requestUrl} with headers:`, JSON.stringify(requestHeaders));
  
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: requestHeaders,
      });
  
      console.log('[Client SyncUser] User fetch response status:', response.status);
  
      if (!response.ok) {
        let errorBody = `(Could not read error body)`;
        try {
            errorBody = await response.text();
        } catch (e) { /* ignore */ }
        console.error(`[Client SyncUser] Failed to fetch current user from ${requestUrl}. Status: ${response.status}. Body: ${errorBody}`);
        return false;
      }
  
      const responseData = await response.json();
      // Adjust based on the actual structure returned by your userApi.user handler
      // It likely returns { user: { id: ..., email: ... } } based on your handler code
      const userToUpsert = responseData.user || responseData;
      console.log('[Client SyncUser] Fetched current user data:', userToUpsert);
  
      if (!userToUpsert || !userToUpsert.id) {
          console.error('[Client SyncUser] Invalid user data received from /api/users/me');
          return false;
      }
  
      // Upsert user in local database
      this.db.upsertUserFromServer(userToUpsert); // Pass the actual user data object
      console.log(`[Client SyncUser] Successfully synced current user ${userToUpsert.id}`);
  
      return true;
    } catch (error) {
      console.error('[Client SyncUser] Error syncing current user:', error);
      return false;
    }
  }

  public async syncNotes(workspaceId: string): Promise<void> {
    try {
      // First sync notes
      await this.pullUpdatesFromServer();
    } catch (error) {
      console.error('Error syncing notes:', error);
      throw error;
    }
  }

  public async syncBlocks(workspaceId: string): Promise<void> {
    try {
      // Then sync blocks
      const localPages = this.db.getNotes();
      for (const note of localPages) {
        await this.pullBlocksForPage(note.id);
      }
    } catch (error) {
      console.error('Error syncing blocks:', error);
      throw error;
    }
  }

  public async syncWorkspaces(workspaceId: string): Promise<void> {
    try {
      // Sync workspaces
      await this.pullWorkspacesFromServer();
    } catch (error) {
      console.error('Error syncing workspaces:', error);
      throw error;
    }
  }

  public async processSyncLog(log: SyncLog): Promise<void> {
    try {
      console.log(`Processing sync log for ${log.entity_type} ${log.entity_id}`);
      
      const entity = JSON.parse(log.payload);
      
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping sync log processing');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping sync log processing');
        return;
      }
      
      // Create a change object for the push API
      const change = {
        entity_type: log.entity_type as 'workspace' | 'note' | 'block',
        action: log.action as 'create' | 'update' | 'delete',
        entity_id: log.entity_id,
        data: entity,
        client_updated_at: entity.updated_at
      };
      
      // Send to the push endpoint instead of individual entity endpoints
      const response = await fetch(`${API_URL}/api/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${accessToken}`
        },
        body: JSON.stringify({ 
          changes: [change],
          sync_token: crypto.randomUUID()
        })
      });
      
      if (!response.ok) {
        // Handle authentication errors specifically
        if (response.status === 401 || response.status === 302) {
          console.log('Authentication error during sync log processing, user needs to log in');
          return;
        }
        
        const errorText = await response.text();
        console.error(`API Error (${response.status}): ${errorText}`);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      // Update sync log status to success
      this.db.updateSyncLogStatus(log.id, 'success');
      
      // If successful, mark entity as synced
      if (response.status !== 204) { // No content
        const data = await response.json();
        const updatedAt = data.updatedAt || new Date().toISOString();
        this.db.markEntityAsSynced(log.entity_type as 'workspace' | 'note' | 'block', log.entity_id, updatedAt);
      } else {
        this.db.markEntityAsSynced(log.entity_type as 'workspace' | 'note' | 'block', log.entity_id, new Date().toISOString());
      }
    } catch (error) {
      console.error(`Error processing sync log ${log.id}:`, error);
      this.db.updateSyncLogStatus(log.id, 'error', String(error));
    }
  }

  private async pullUpdatesFromServer(): Promise<void> {
    console.log('Pulling updates from server:', API_URL);
    
    try {
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping sync');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping sync');
        return;
      }
      
      // Fetch notes from server
      const notesResponse = await fetch(`${API_URL}/api/notes`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${accessToken}`
        }
      });
      
      if (!notesResponse.ok) {
        // Handle authentication errors specifically
        if (notesResponse.status === 401 || notesResponse.status === 302) {
          console.log('Authentication error during sync, user needs to log in');
          return;
        }
        
        const errorText = await notesResponse.text();
        console.error(`API Error (${notesResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch notes: ${notesResponse.status} ${notesResponse.statusText}`);
      }
      
      // Check if the response is valid JSON
      let notesData;
      try {
        notesData = await notesResponse.json();
      } catch (error) {
        console.error('Failed to parse API response:', error);
        throw new Error('Invalid API response format');
      }
      
      // Validate the response structure
      if (!notesData || !Array.isArray(notesData.notes)) {
        console.error('Unexpected API response structure:', notesData);
        throw new Error('Unexpected API response structure');
      }
      
      const serverPages = notesData.notes as Note[];
      
      // Get all local notes
      const localPages = this.db.getNotes();
      const localPagesMap = new Map<string, Note>();
      
      localPages.forEach(note => {
        localPagesMap.set(note.id, note);
      });
      
      // Process server notes
      for (const serverPage of serverPages) {
        const localPage = localPagesMap.get(serverPage.id);
        
        if (!localPage) {
          // New note from server, create locally
          const newPage = {
            ...serverPage,
            sync_status: 'synced' as const,
            server_updated_at: serverPage.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO notes (id, title, parent_id, user_id, is_favorite, type, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @title, @parent_id, @user_id, @is_favorite, @type, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newPage);
          
          // Pull blocks for this note
          await this.pullBlocksForPage(serverPage.id);
        } else if (localPage.sync_status !== 'pending') {
          // Page exists locally and is not pending sync
          // Check if server version is newer
          const serverUpdatedAt = new Date(serverPage.updated_at).getTime();
          const localUpdatedAt = new Date(localPage.updated_at).getTime();
          
          if (serverUpdatedAt > localUpdatedAt) {
            // Server version is newer, update local
            const updatedPage = {
              ...serverPage,
              sync_status: 'synced' as const,
              server_updated_at: serverPage.updated_at
            };
            
            // Use direct SQL to bypass sync log creation
            const stmt = this.db.getDb().prepare(`
              UPDATE notes 
              SET title = @title, 
                  parent_id = @parent_id, 
                  is_favorite = @is_favorite, 
                  type = @type, 
                  updated_at = @updated_at,
                  sync_status = @sync_status,
                  server_updated_at = @server_updated_at
              WHERE id = @id
            `);
            
            stmt.run(updatedPage);
            
            // Pull blocks for this note
            await this.pullBlocksForPage(serverPage.id);
          }
        }
        
        // Remove from map to track what's been processed
        localPagesMap.delete(serverPage.id);
      }
      
      // Any remaining notes in the map don't exist on the server
      // If they're not pending sync, they were deleted on the server
      for (const [id, note] of localPagesMap.entries()) {
        if (note.sync_status !== 'pending') {
          this.db.deleteNote(id);
        }
      }
    } catch (error) {
      console.error('Error pulling updates from server:', error);
    }
  }

  private async pullBlocksForPage(noteId: string): Promise<void> {
    try {
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping block sync');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping block sync');
        return;
      }
      
      // Fetch blocks for this note from the server
      const blocksResponse = await fetch(`${API_URL}/api/notes/${noteId}/blocks`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${accessToken}`
        }
      });
      
      if (!blocksResponse.ok) {
        // Handle authentication errors specifically
        if (blocksResponse.status === 401 || blocksResponse.status === 302) {
          console.log('Authentication error during block sync, user needs to log in');
          return;
        }
        
        const errorText = await blocksResponse.text();
        console.error(`API Error (${blocksResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch blocks: ${blocksResponse.status} ${blocksResponse.statusText}`);
      }
      
      // Check if the response is valid JSON
      let blocksData;
      try {
        blocksData = await blocksResponse.json();
      } catch (error) {
        console.error('Failed to parse API response:', error);
        throw new Error('Invalid API response format');
      }
      
      // Validate the response structure
      if (!blocksData || !Array.isArray(blocksData.blocks)) {
        console.error('Unexpected API response structure:', blocksData);
        throw new Error('Unexpected API response structure');
      }
      
      const serverBlocks = blocksData.blocks as Block[];
      
      // Get local blocks for this note
      const localBlocks = this.db.getBlocks(noteId);
      const localBlocksMap = new Map<string, Block>();
      
      localBlocks.forEach(block => {
        localBlocksMap.set(block.id, block);
      });
      
      // Process server blocks
      for (const serverBlock of serverBlocks) {
        const localBlock = localBlocksMap.get(serverBlock.id);
        
        if (!localBlock) {
          // New block from server, create locally
          const newBlock = {
            ...serverBlock,
            sync_status: 'synced' as const,
            server_updated_at: serverBlock.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO blocks (id, note_id, user_id, type, content, metadata, order_index, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @note_id, @user_id, @type, @content, @metadata, @order_index, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newBlock);
        } else if (localBlock.sync_status !== 'pending') {
          // Block exists locally and is not pending sync
          // Check if server version is newer
          const serverUpdatedAt = new Date(serverBlock.updated_at).getTime();
          const localUpdatedAt = new Date(localBlock.updated_at).getTime();
          
          if (serverUpdatedAt > localUpdatedAt) {
            // Server version is newer, update local
            const updatedBlock = {
              ...serverBlock,
              sync_status: 'synced' as const,
              server_updated_at: serverBlock.updated_at
            };
            
            // Use direct SQL to bypass sync log creation
            const stmt = this.db.getDb().prepare(`
              UPDATE blocks 
              SET type = @type, 
                  content = @content, 
                  metadata = @metadata, 
                  order_index = @order_index, 
                  updated_at = @updated_at,
                  sync_status = @sync_status,
                  server_updated_at = @server_updated_at
              WHERE id = @id
            `);
            
            stmt.run(updatedBlock);
          }
        }
        
        // Remove from map to track what's been processed
        localBlocksMap.delete(serverBlock.id);
      }
      
      // Any remaining blocks in the map don't exist on the server
      // If they're not pending sync, they were deleted on the server
      for (const [id, block] of localBlocksMap.entries()) {
        if (block.sync_status !== 'pending') {
          this.db.deleteBlock(id);
        }
      }
    } catch (error) {
      console.error(`Error pulling blocks for note ${noteId}:`, error);
    }
  }

  private async pullWorkspacesFromServer(): Promise<void> {
    try {
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping workspace sync');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping workspace sync');
        return;
      }
      
      // Fetch workspaces from server
      const workspacesResponse = await fetch(`${API_URL}/api/workspaces`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${accessToken}`
        }
      });
      
      if (!workspacesResponse.ok) {
        // Handle authentication errors specifically
        if (workspacesResponse.status === 401 || workspacesResponse.status === 302) {
          console.log('Authentication error during workspace sync, user needs to log in');
          return;
        }
        
        const errorText = await workspacesResponse.text();
        console.error(`API Error (${workspacesResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch workspaces: ${workspacesResponse.status} ${workspacesResponse.statusText}`);
      }
      
      // Check if the response is valid JSON
      let workspacesData;
      try {
        workspacesData = await workspacesResponse.json();
      } catch (error) {
        console.error('Failed to parse API response:', error);
        throw new Error('Invalid API response format');
      }
      
      // Validate the response structure
      if (!workspacesData || !Array.isArray(workspacesData.workspaces)) {
        console.error('Unexpected API response structure:', workspacesData);
        throw new Error('Unexpected API response structure');
      }
      
      const serverWorkspaces = workspacesData.workspaces;
      
      // Get local workspaces
      const localWorkspaces = this.db.getWorkspaces();
      const localWorkspacesMap = new Map<string, any>();
      
      localWorkspaces.forEach(workspace => {
        localWorkspacesMap.set(workspace.id, workspace);
      });
      
      // Process server workspaces
      for (const serverWorkspace of serverWorkspaces) {
        const localWorkspace = localWorkspacesMap.get(serverWorkspace.id);
        
        if (!localWorkspace) {
          // New workspace from server, create locally
          const newWorkspace = {
            ...serverWorkspace,
            sync_status: 'synced' as const,
            server_updated_at: serverWorkspace.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO workspaces (id, title, user_id, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @title, @user_id, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newWorkspace);
        } else if (localWorkspace.sync_status !== 'pending') {
          // Workspace exists locally and is not pending sync
          // Check if server version is newer
          const serverUpdatedAt = new Date(serverWorkspace.updated_at).getTime();
          const localUpdatedAt = new Date(localWorkspace.updated_at).getTime();
          
          if (serverUpdatedAt > localUpdatedAt) {
            // Server version is newer, update local
            const updatedWorkspace = {
              ...serverWorkspace,
              sync_status: 'synced' as const,
              server_updated_at: serverWorkspace.updated_at
            };
            
            // Use direct SQL to bypass sync log creation
            const stmt = this.db.getDb().prepare(`
              UPDATE workspaces 
              SET title = @title, 
                  updated_at = @updated_at,
                  sync_status = @sync_status,
                  server_updated_at = @server_updated_at
              WHERE id = @id
            `);
            
            stmt.run(updatedWorkspace);
          }
        }
        
        // Remove from map to track what's been processed
        localWorkspacesMap.delete(serverWorkspace.id);
      }
      
      // Any remaining workspaces in the map don't exist on the server
      // If they're not pending sync, they were deleted on the server
      for (const [id, workspace] of localWorkspacesMap.entries()) {
        if (workspace.sync_status !== 'pending') {
          this.db.deleteWorkspace(id);
        }
      }
    } catch (error) {
      console.error('Error pulling workspaces from server:', error);
    }
  }

  public async syncWorkspace(workspaceId: string): Promise<SyncResult> {
    try {
      // 1. Compute local hash
      const localHash = this.computeWorkspaceHash(workspaceId);
      
      // 2. Get server comparison
      const { data } = await fetch(`${API_URL}/api/sync/workspace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `wos-session=${this.auth.getAccessToken()}`
        },
        body: JSON.stringify({ 
          workspaceId,
          clientHash: localHash
        })
      }).then(response => response.json());

      // 3. Process changes if needed
      if (data.requiresSync) {
        await this.applySyncChanges(
          workspaceId,
          data.entitiesToUpdate,
          data.entitiesToDelete
        );
        
        // Update local sync status
        await this.markEntitiesAsSynced(workspaceId);
        
        return {
          status: 'completed',
          updated: data.entitiesToUpdate?.length || 0,
          deleted: data.entitiesToDelete?.length || 0
        };
      }
      
      return { status: 'up-to-date' };
    } catch (error: any) {
      console.error('Sync failed:', error);
      return { 
        status: 'failed',
        error: error.message || 'Unknown error',
      };
    }
  }

  // Implement the `applySyncChanges` method
  private async applySyncChanges(workspaceId: string, entitiesToUpdate: any[], entitiesToDelete: any[]): Promise<void> {
    console.log(`Applying sync changes for workspace ${workspaceId}`);

    // Update entities in the local database
    for (const entity of entitiesToUpdate) {
      if (entity.type === 'note') {
        this.db.updateNote(entity.data.id, entity.data);
      } else if (entity.type === 'block') {
        this.db.updateBlock(entity.data.id, entity.data);
      }
    }

    // Delete entities from the local database
    for (const entity of entitiesToDelete) {
      if (entity.type === 'note') {
        this.db.deleteNote(entity.id);
      } else if (entity.type === 'block') {
        this.db.deleteBlock(entity.id);
      }
    }
  }

  // Implement the `markEntitiesAsSynced` method
  private async markEntitiesAsSynced(workspaceId: string): Promise<void> {
    console.log(`Marking entities as synced for workspace ${workspaceId}`);

    // Mark all entities in the workspace as synced
    const notes = this.db.getNotes(workspaceId);
    for (const note of notes) {
      this.db.markNoteAsSynced(note.id, note.updated_at);
    }

    const blocks = this.db.getBlocks(workspaceId);
    for (const block of blocks) {
      this.db.markBlockAsSynced(block.id, block.updated_at);
    }
  }

  private async updateWorkspaceHash(workspaceId: string): Promise<void> {
    const hash = this.computeWorkspaceHash(workspaceId);
    await fetch(`${API_URL}/api/sync/update-hash`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `wos-session=${this.auth.getAccessToken()}`
      },
      body: JSON.stringify({ 
        workspaceId,
        hash
      })
    }).then(response => response.json());
  }

  public shutdown(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export default SyncService;