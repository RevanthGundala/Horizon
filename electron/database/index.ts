import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { SQL_SCHEMAS } from '../../shared/sql-schemas';

// Types
export interface Workspace {
  id: string;
  user_id: string;
  name: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending';
  server_updated_at?: string;
}

export interface Note {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  content?: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending';
  user_id: string;
}

export interface Block {
  id: string;
  note_id: string;
  user_id: string;
  type: string;
  content: string | null;
  metadata: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending';
}

export interface SyncLog {
  id: string;
  entity_type: 'workspace' | 'note' | 'block';
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  status: 'pending' | 'success' | 'error';
  payload: string;
  created_at: string;
  synced_at: string | null;
  error_message: string | null;
}

class DatabaseService {
  private db: Database.Database;
  private static instance: DatabaseService;

  private constructor() {
    // Ensure the database directory exists
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'database');
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    const dbPath = path.join(dbDir, 'horizon.db');
    this.db = new Database(dbPath);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    // Initialize database schema
    this.initSchema();

    console.log(`🔶 [ELECTRON DB] SQLite path: ${dbPath}`);
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Expose the database instance for direct access when needed
  public getDb(): Database.Database {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(SQL_SCHEMAS.WORKSPACES);
    this.db.exec(SQL_SCHEMAS.NOTES);
    this.db.exec(SQL_SCHEMAS.BLOCKS);
    this.db.exec(SQL_SCHEMAS.SYNC_LOG);
    this.db.exec(SQL_SCHEMAS.USERS);
  }

  // Workspaces CRUD operations
  public getWorkspaces(): Workspace[] {
    const stmt = this.db.prepare('SELECT * FROM workspaces ORDER BY updated_at DESC');
    return stmt.all() as Workspace[];
  }

  public getWorkspace(id: string): Workspace | undefined {
    const stmt = this.db.prepare('SELECT * FROM workspaces WHERE id = ?');
    return stmt.get(id) as Workspace | undefined;
  }

  public createWorkspace(workspace: Omit<Workspace, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Workspace {
    console.log(`🔶 [ELECTRON DB] Creating workspace with ID: ${workspace.id}, name: ${workspace.name}`);
    console.log(`🔶 [ELECTRON DB] User ID for workspace: ${workspace.user_id}`);
    
    const now = new Date().toISOString();
    
    try {
      // Convert boolean to integer for SQLite
      const is_favorite_value = workspace.is_favorite ? 1 : 0;
      
      // Log the exact data we're about to insert
      console.log(`🔶 [ELECTRON DB] Workspace data before insert:`, {
        id: workspace.id,
        user_id: workspace.user_id,
        name: workspace.name,
        is_favorite: is_favorite_value, // Show the integer value
      });
      
      // Use positional parameters for better SQLite compatibility
      const stmt = this.db.prepare(`
        INSERT INTO workspaces (id, user_id, name, is_favorite, created_at, updated_at, sync_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        workspace.id,
        workspace.user_id,
        workspace.name,
        is_favorite_value, // Use the integer value
        now,
        now,
        'pending'
      );
      
      console.log(`🔶 [ELECTRON DB] Successfully inserted workspace with ID: ${workspace.id}`);
      
      // Create the complete Workspace object for the return value
      const newWorkspace: Workspace = {
        id: workspace.id,
        user_id: workspace.user_id,
        name: workspace.name,
        is_favorite: Boolean(is_favorite_value), // Convert back to boolean for TypeScript
        created_at: now,
        updated_at: now,
        sync_status: 'pending'
      };
      
      // Add to sync log
      this.addToSyncLog('workspace', newWorkspace.id, 'create', JSON.stringify(newWorkspace));
      
      return newWorkspace;
    } catch (error) {
      console.error(`🔶 [ELECTRON DB] Error inserting workspace:`, error);
      throw error;
    }
  }

  public updateWorkspace(id: string, updates: Partial<Omit<Workspace, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Workspace | undefined {
    const workspace = this.getWorkspace(id);
    if (!workspace) return undefined;

    const now = new Date().toISOString();
    
    // Convert boolean to number for SQLite compatibility if present
    const is_favorite_value = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (workspace.is_favorite ? 1 : 0);
    
    const stmt = this.db.prepare(`
      UPDATE workspaces 
      SET name = ?, 
          is_favorite = ?, 
          updated_at = ?,
          sync_status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updates.name || workspace.name,
      is_favorite_value,
      now, // updated_at
      'pending', // sync_status
      id
    );
    
    const updatedWorkspace: Workspace = {
      ...workspace,
      ...updates,
      updated_at: now,
      sync_status: 'pending',
      is_favorite: Boolean(is_favorite_value) // Ensure boolean type
    };
    
    // Add to sync log
    this.addToSyncLog('workspace', updatedWorkspace.id, 'update', JSON.stringify(updatedWorkspace));
    
    return updatedWorkspace;
  }

  public deleteWorkspace(id: string): void {
    const workspace = this.getWorkspace(id);
    if (!workspace) return;

    // Add to sync log before deleting
    this.addToSyncLog('workspace', id, 'delete', JSON.stringify({ id }));
    
    const stmt = this.db.prepare('DELETE FROM workspaces WHERE id = ?');
    stmt.run(id);
  }

  // Notes CRUD operations
  public getNotes(workspaceId?: string, parentId?: string): Note[] {
    if (workspaceId && parentId) {
      const stmt = this.db.prepare('SELECT * FROM notes WHERE workspace_id = ? AND parent_id = ? ORDER BY updated_at DESC');
      return stmt.all(workspaceId, parentId) as Note[];
    } else if (workspaceId) {
      const stmt = this.db.prepare('SELECT * FROM notes WHERE workspace_id = ? AND parent_id IS NULL ORDER BY updated_at DESC');
      return stmt.all(workspaceId) as Note[];
    } else if (parentId) {
      const stmt = this.db.prepare('SELECT * FROM notes WHERE parent_id = ? ORDER BY updated_at DESC');
      return stmt.all(parentId) as Note[];
    }
    
    const stmt = this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC');
    return stmt.all() as Note[];
  }

  public getNote(id: string): Note | undefined {
    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    return stmt.get(id) as Note | undefined;
  }

  public createNote(note: Omit<Note, 'created_at' | 'updated_at' | 'sync_status'> & { id?: string, user_id: string }): Note {
    const noteId = note.id || uuidv4();
    console.log(`🔶 [ELECTRON DB] Creating note with ID: ${noteId}, title: ${note.title}`);
    
    const now = new Date().toISOString();
    
    try {
      // Convert boolean to integer for SQLite
      const is_favorite_value = note.is_favorite ? 1 : 0;
      
      // Log the exact data we're about to insert
      console.log(`🔶 [ELECTRON DB] Note data before insert:`, {
        id: noteId,
        workspace_id: note.workspace_id,
        parent_id: note.parent_id,
        title: note.title,
        content: note.content,
        is_favorite: is_favorite_value,
        user_id: note.user_id
      });
      
      // Use positional parameters for better SQLite compatibility
      const stmt = this.db.prepare(`
        INSERT INTO notes (id, workspace_id, parent_id, title, content, is_favorite, created_at, updated_at, sync_status, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `);
      
      stmt.run(
        noteId,
        note.workspace_id,
        note.parent_id,
        note.title,
        note.content,
        is_favorite_value,
        now,
        now,
        note.user_id
      );
      
      console.log(`🔶 [ELECTRON DB] Successfully inserted note with ID: ${noteId}`);
      
      // Create the complete Note object for the return value
      const newNote: Note = {
        id: noteId,
        workspace_id: note.workspace_id,
        parent_id: note.parent_id,
        title: note.title,
        content: note.content,
        is_favorite: Boolean(is_favorite_value),
        user_id: note.user_id,
        created_at: now,
        updated_at: now,
        sync_status: 'pending'
      };
      
      // Add to sync log
      this.addToSyncLog('note', newNote.id, 'create', JSON.stringify(newNote));
      
      return newNote;
    } catch (error) {
      console.error(`🔶 [ELECTRON DB] Error inserting note:`, error);
      throw error;
    }
  }

  public updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status'>>): Note | undefined {
    const note = this.getNote(id);
    if (!note) return undefined;

    const now = new Date().toISOString();
    
    // Convert boolean to number for SQLite compatibility if present
    const is_favorite_value = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (note.is_favorite ? 1 : 0);
    
    const stmt = this.db.prepare(`
      UPDATE notes 
      SET title = ?, 
          content = ?, 
          parent_id = ?, 
          is_favorite = ?, 
          updated_at = ?,
          sync_status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updates.title || note.title,
      updates.content || note.content,
      updates.parent_id !== undefined ? updates.parent_id : note.parent_id,
      is_favorite_value,
      now, // updated_at
      'pending', // sync_status
      id
    );
    
    const updatedNote: Note = {
      ...note,
      ...updates,
      updated_at: now,
      sync_status: 'pending'
    };
    
    // Add to sync log
    this.addToSyncLog('note', updatedNote.id, 'update', JSON.stringify(updatedNote));
    
    return updatedNote;
  }

  public deleteNote(id: string): void {
    const note = this.getNote(id);
    if (!note) return;

    // Add to sync log before deleting
    this.addToSyncLog('note', id, 'delete', JSON.stringify({ id }));
    
    const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
    stmt.run(id);
  }

  // Blocks CRUD operations
  public getBlocks(noteId: string): Block[] {
    console.log(`🔶 [ELECTRON DB] Getting blocks for note: ${noteId}`);
    const stmt = this.db.prepare('SELECT * FROM blocks WHERE note_id = ? ORDER BY order_index ASC');
    const blocks = stmt.all(noteId) as Block[];
    console.log(`🔶 [ELECTRON DB] Found ${blocks.length} blocks for note ${noteId}`);
    
    // Log block details for debugging
    if (blocks.length > 0) {
      const editorBlocks = blocks.filter(b => b.type === 'editor');
      console.log(`🔶 [ELECTRON DB] Found ${editorBlocks.length} editor blocks for note ${noteId}`);
      editorBlocks.forEach(b => {
        console.log(`🔶 [ELECTRON DB] Editor block ${b.id} for note ${b.note_id}, content length: ${b.content ? b.content.length : 0}`);
      });
    }
    
    return blocks;
  }
  
  public getBlocksForWorkspace(workspaceId: string): Block[] {
    console.log(`🔶 [ELECTRON DB] Getting all blocks for workspace: ${workspaceId}`);
    
    // First get all notes in the workspace
    const notes = this.getNotes(workspaceId);
    const noteIds = notes.map(note => note.id);
    
    if (noteIds.length === 0) {
      console.log(`🔶 [ELECTRON DB] No notes found in workspace ${workspaceId}, returning empty blocks array`);
      return [];
    }
    
    // Then get all blocks for those notes
    // Using a placeholders string with the right number of question marks
    const placeholders = noteIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT * FROM blocks WHERE note_id IN (${placeholders}) ORDER BY note_id, order_index ASC`);
    
    // Execute with all note IDs as parameters
    const blocks = stmt.all(...noteIds) as Block[];
    console.log(`🔶 [ELECTRON DB] Found ${blocks.length} blocks across ${noteIds.length} notes in workspace ${workspaceId}`);
    
    return blocks;
  }

  public getBlock(id: string): Block | undefined {
    const stmt = this.db.prepare('SELECT * FROM blocks WHERE id = ?');
    return stmt.get(id) as Block | undefined;
  }

  public createBlock(block: Omit<Block, 'created_at' | 'updated_at' | 'sync_status'> & { id?: string, user_id: string }): Block {
    console.log(`🔶 [ELECTRON DB] Creating block for note: ${block.note_id}, type: ${block.type}`);
    
    const now = new Date().toISOString();
    const blockId = block.id || uuidv4();
    
    try {
      // Log the exact data we're about to insert
      console.log(`🔶 [ELECTRON DB] Block data before insert:`, {
        id: blockId,
        note_id: block.note_id,
        user_id: block.user_id,
        type: block.type,
        content: block.content ? `${block.content.substring(0, 50)}...` : null,
        metadata: block.metadata,
        order_index: block.order_index
      });
      
      // Use positional parameters for better SQLite compatibility
      const stmt = this.db.prepare(`
        INSERT INTO blocks (id, note_id, user_id, type, content, metadata, order_index, created_at, updated_at, sync_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);
      
      stmt.run(
        blockId,
        block.note_id,
        block.user_id,
        block.type,
        block.content,
        block.metadata,
        block.order_index,
        now,
        now
      );
      
      console.log(`🔶 [ELECTRON DB] Successfully inserted block with ID: ${blockId}`);
      
      // Create the complete Block object for the return value
      const newBlock: Block = {
        id: blockId,
        note_id: block.note_id,
        user_id: block.user_id,
        type: block.type,
        content: block.content,
        metadata: block.metadata,
        order_index: block.order_index,
        created_at: now,
        updated_at: now,
        sync_status: 'pending'
      };
      
      // Add to sync log
      this.addToSyncLog('block', newBlock.id, 'create', JSON.stringify(newBlock));
      
      return newBlock;
    } catch (error) {
      console.error(`🔶 [ELECTRON DB] Error inserting block:`, error);
      throw error;
    }
  }

  public updateBlock(id: string, updates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status'>>): Block | undefined {
    console.log(`🔶 [ELECTRON DB] Updating block: ${id}`);
    
    // Get the current block
    const currentBlock = this.getBlock(id);
    if (!currentBlock) {
      console.log(`🔶 [ELECTRON DB] Block not found: ${id}`);
      return undefined;
    }
    
    console.log(`🔶 [ELECTRON DB] Updating block ${id} for note ${currentBlock.note_id}`);
    
    try {
      const now = new Date().toISOString();
      
      // Merge the current block with the updates
      const updatedBlock: Block = {
        ...currentBlock,
        ...updates,
        updated_at: now,
        sync_status: 'pending' as 'synced' | 'pending'
      };
      
      // Log the data being updated (truncate content for logging)
      console.log(`🔶 [ELECTRON DB] Update data:`, {
        ...updates,
        content: updates.content ? `${updates.content.substring(0, 50)}...` : undefined
      });
      
      // Use positional parameters for better SQLite compatibility
      const stmt = this.db.prepare(`
        UPDATE blocks 
        SET type = ?, 
            content = ?, 
            metadata = ?, 
            order_index = ?, 
            updated_at = ?,
            sync_status = ?
        WHERE id = ?
      `);
      
      stmt.run(
        updatedBlock.type,
        updatedBlock.content,
        updatedBlock.metadata,
        updatedBlock.order_index,
        updatedBlock.updated_at,
        updatedBlock.sync_status,
        id
      );
      
      // Add to sync log
      this.addToSyncLog('block', id, 'update', JSON.stringify(updatedBlock));
      
      console.log(`🔶 [ELECTRON DB] Updated block ${id} for note ${currentBlock.note_id}`);
      if (updatedBlock.type === 'editor') {
        console.log(`🔶 [ELECTRON DB] Updated editor block with content length: ${updatedBlock.content ? updatedBlock.content.length : 0}`);
      }
      
      return updatedBlock;
    } catch (error) {
      console.error(`🔶 [ELECTRON DB] Error updating block:`, error);
      throw error;
    }
  }

  public deleteBlock(id: string): void {
    const block = this.getBlock(id);
    if (!block) return;

    // Add to sync log before deleting
    this.addToSyncLog('block', id, 'delete', JSON.stringify({ id }));
    
    const stmt = this.db.prepare('DELETE FROM blocks WHERE id = ?');
    stmt.run(id);
  }

  public updateBlocksBatch(blocks: Array<Block | Partial<Block> & { id: string }>): void {
    const transaction = this.db.transaction((blocksToUpdate: Array<Block | Partial<Block> & { id: string }>) => {
      const updateStmt = this.db.prepare(`
        UPDATE blocks 
        SET type = COALESCE(@type, type), 
            content = COALESCE(@content, content), 
            metadata = COALESCE(@metadata, metadata), 
            order_index = COALESCE(@order_index, order_index), 
            updated_at = @updated_at,
            sync_status = 'pending'
        WHERE id = @id
      `);

      const now = new Date().toISOString();
      
      for (const block of blocksToUpdate) {
        const updatedBlock = {
          ...block,
          updated_at: now
        };
        
        updateStmt.run(updatedBlock);
        
        // Add to sync log
        this.addToSyncLog('block', block.id, 'update', JSON.stringify(updatedBlock));
      }
    });

    transaction(blocks);
  }

  // Sync log operations
  private addToSyncLog(entityType: 'workspace' | 'note' | 'block', entityId: string, action: 'create' | 'update' | 'delete', payload: string): void {
    const now = new Date().toISOString();
    const id = `${entityType}_${entityId}_${now}`;
    
    const stmt = this.db.prepare(`
      INSERT INTO sync_log (id, entity_type, entity_id, action, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, entityType, entityId, action, payload, now);
  }

  public getPendingSyncLogs(): SyncLog[] {
    const stmt = this.db.prepare("SELECT * FROM sync_log WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all() as SyncLog[];
  }

  public updateSyncLogStatus(id: string, status: 'success' | 'error', errorMessage?: string): void {
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE sync_log 
      SET status = @status, 
          synced_at = @synced_at,
          error_message = @error_message
      WHERE id = @id
    `);
    
    stmt.run({
      id,
      status,
      synced_at: now,
      error_message: errorMessage || null
    });
  }

  // Sync operations
  // Methods for direct CRUD operations (without adding to sync log)
  // These are used by the sync system to avoid circular updates
  
  public createWorkspaceFromServer(workspace: Workspace, skipSyncLog = false): Workspace {
    const now = new Date().toISOString();
    const is_favorite_value = workspace.is_favorite ? 1 : 0;
    
    const stmt = this.db.prepare(`
      INSERT INTO workspaces (id, user_id, name, is_favorite, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      workspace.id,
      workspace.user_id,
      workspace.name,
      is_favorite_value,
      workspace.created_at || now,
      workspace.updated_at || now,
      'synced'
    );
    
    const newWorkspace = {
      ...workspace,
      created_at: workspace.created_at || now,
      updated_at: workspace.updated_at || now,
      sync_status: 'synced' as 'synced' | 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('workspace', newWorkspace.id, 'create', JSON.stringify(newWorkspace));
    }
    
    return newWorkspace;
  }
  
  public updateWorkspaceFromServer(id: string, updates: Partial<Workspace>, skipSyncLog = false): Workspace | undefined {
    const workspace = this.getWorkspace(id);
    if (!workspace) return undefined;
    
    const is_favorite_value = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (workspace.is_favorite ? 1 : 0);
    
    const stmt = this.db.prepare(`
      UPDATE workspaces 
      SET name = ?, 
          is_favorite = ?, 
          updated_at = ?,
          sync_status = ?
      WHERE id = ?
    `);
    
    const now = updates.updated_at || new Date().toISOString();
    
    stmt.run(
      updates.name || workspace.name,
      is_favorite_value,
      now,
      skipSyncLog ? 'synced' : 'pending',
      id
    );
    
    const updatedWorkspace: Workspace = {
      ...workspace,
      ...updates,
      is_favorite: Boolean(is_favorite_value),
      updated_at: now,
      sync_status: skipSyncLog ? 'synced' : 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('workspace', updatedWorkspace.id, 'update', JSON.stringify(updatedWorkspace));
    }
    
    return updatedWorkspace;
  }
  
  public createNoteFromServer(note: Omit<Note, 'sync_status'>, skipSyncLog = false): Note {
    const noteId = note.id || uuidv4();
    const now = new Date().toISOString();
    const is_favorite_value = note.is_favorite ? 1 : 0;
    
    const stmt = this.db.prepare(`
      INSERT INTO notes (id, workspace_id, parent_id, title, content, is_favorite, created_at, updated_at, sync_status, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      noteId,
      note.workspace_id,
      note.parent_id,
      note.title,
      note.content,
      is_favorite_value,
      note.created_at || now,
      note.updated_at || now,
      skipSyncLog ? 'synced' : 'pending',
      note.user_id
    );
    
    const newNote: Note = {
      ...note,
      id: noteId,
      created_at: note.created_at || now,
      updated_at: note.updated_at || now,
      sync_status: skipSyncLog ? 'synced' : 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('note', newNote.id, 'create', JSON.stringify(newNote));
    }
    
    return newNote;
  }
  
  public updateNoteFromServer(id: string, updates: Partial<Note>, skipSyncLog = false): Note | undefined {
    const note = this.getNote(id);
    if (!note) return undefined;
    
    const is_favorite_value = updates.is_favorite !== undefined ? (updates.is_favorite ? 1 : 0) : (note.is_favorite ? 1 : 0);
    const now = updates.updated_at || new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE notes 
      SET title = ?, 
          content = ?, 
          parent_id = ?, 
          is_favorite = ?, 
          updated_at = ?,
          sync_status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updates.title || note.title,
      updates.content !== undefined ? updates.content : note.content,
      updates.parent_id !== undefined ? updates.parent_id : note.parent_id,
      is_favorite_value,
      now,
      skipSyncLog ? 'synced' : 'pending',
      id
    );
    
    const updatedNote: Note = {
      ...note,
      ...updates,
      is_favorite: Boolean(is_favorite_value),
      updated_at: now,
      sync_status: skipSyncLog ? 'synced' : 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('note', updatedNote.id, 'update', JSON.stringify(updatedNote));
    }
    
    return updatedNote;
  }
  
  public deleteNoteFromServer(id: string, skipSyncLog = false): void {
    const note = this.getNote(id);
    if (!note) return;
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('note', id, 'delete', JSON.stringify({ id }));
    }
    
    const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
    stmt.run(id);
  }
  
  public createBlockFromServer(block: Block, skipSyncLog = false): Block {
    const blockId = block.id || uuidv4();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO blocks (id, note_id, user_id, type, content, metadata, order_index, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      blockId,
      block.note_id,
      block.user_id,
      block.type,
      block.content,
      block.metadata,
      block.order_index,
      block.created_at || now,
      block.updated_at || now,
      skipSyncLog ? 'synced' : 'pending'
    );
    
    const newBlock: Block = {
      ...block,
      id: blockId,
      created_at: block.created_at || now,
      updated_at: block.updated_at || now,
      sync_status: skipSyncLog ? 'synced' : 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('block', newBlock.id, 'create', JSON.stringify(newBlock));
    }
    
    return newBlock;
  }
  
  public updateBlockFromServer(id: string, updates: Partial<Block>, skipSyncLog = false): Block | undefined {
    const block = this.getBlock(id);
    if (!block) return undefined;
    
    const now = updates.updated_at || new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE blocks 
      SET type = ?, 
          content = ?, 
          metadata = ?, 
          order_index = ?, 
          updated_at = ?,
          sync_status = ?
      WHERE id = ?
    `);
    
    stmt.run(
      updates.type || block.type,
      updates.content !== undefined ? updates.content : block.content,
      updates.metadata !== undefined ? updates.metadata : block.metadata,
      updates.order_index !== undefined ? updates.order_index : block.order_index,
      now,
      skipSyncLog ? 'synced' : 'pending',
      id
    );
    
    const updatedBlock: Block = {
      ...block,
      ...updates,
      updated_at: now,
      sync_status: skipSyncLog ? 'synced' : 'pending'
    };
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('block', updatedBlock.id, 'update', JSON.stringify(updatedBlock));
    }
    
    return updatedBlock;
  }
  
  public deleteBlockFromServer(id: string, skipSyncLog = false): void {
    const block = this.getBlock(id);
    if (!block) return;
    
    // Only add to sync log if not skipped
    if (!skipSyncLog) {
      this.addToSyncLog('block', id, 'delete', JSON.stringify({ id }));
    }
    
    const stmt = this.db.prepare('DELETE FROM blocks WHERE id = ?');
    stmt.run(id);
  }
  
  public markEntityAsSynced(entityType: 'workspace' | 'note' | 'block', entityId: string, serverUpdatedAt: string): void {
    const tableMap = {
      workspace: 'workspaces',
      note: 'notes',
      block: 'blocks'
    };
    
    const table = tableMap[entityType];
    const stmt = this.db.prepare(`
      UPDATE ${table} 
      SET sync_status = 'synced', server_updated_at = ? 
      WHERE id = ?
    `);
    stmt.run(serverUpdatedAt, entityId);
  }
  
  // Convenience methods for marking specific entity types as synced
  public markWorkspaceAsSynced(id: string, serverUpdatedAt: string): void {
    this.markEntityAsSynced('workspace', id, serverUpdatedAt);
  }
  
  public markNoteAsSynced(id: string, serverUpdatedAt: string): void {
    this.markEntityAsSynced('note', id, serverUpdatedAt);
  }
  
  public markBlockAsSynced(id: string, serverUpdatedAt: string): void {
    this.markEntityAsSynced('block', id, serverUpdatedAt);
  }

  public markEntityAsConflict(entityType: 'note' | 'block', entityId: string): void {
    const table = entityType === 'note' ? 'notes' : 'blocks';
    
    const stmt = this.db.prepare(`
      UPDATE ${table} 
      SET sync_status = 'conflict'
      WHERE id = ?
    `);
    
    stmt.run(entityId);
  }

  // Get all entities that need syncing
  public getEntitiesToSync(): { notes: Note[]; blocks: Block[] } {
    const notesStmt = this.db.prepare("SELECT * FROM notes WHERE sync_status = 'pending'");
    const blocksStmt = this.db.prepare("SELECT * FROM blocks WHERE sync_status = 'pending'");
    
    return {
      notes: notesStmt.all() as Note[],
      blocks: blocksStmt.all() as Block[]
    };
  }

  // Close the database connection
  public close(): void {
    this.db.close();
  }
}

export default DatabaseService;
