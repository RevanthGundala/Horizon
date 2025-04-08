import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

// Types
export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  user_id: string;
  is_favorite: boolean;
  type: string | null;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
  server_updated_at: string | null;
}

export interface Block {
  id: string;
  page_id: string;
  user_id: string;
  type: string;
  content: string | null;
  metadata: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
  server_updated_at: string | null;
}

export interface SyncLog {
  id: string;
  entity_type: 'page' | 'block';
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  status: 'pending' | 'success' | 'error';
  payload: string;
  created_at: string;
  synced_at: string | null;
  error_message: string | null;
}

export interface NetworkStatus {
  id: number;
  is_online: boolean;
  last_checked: string;
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
    // Create pages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        user_id TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT FALSE,
        type TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT
      );
    `);

    // Create blocks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT,
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      );
    `);

    // Create sync_log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synced_at TEXT,
        error_message TEXT
      );
    `);

    // Create network_status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS network_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        is_online BOOLEAN NOT NULL DEFAULT FALSE,
        last_checked TEXT NOT NULL
      );
    `);

    // Insert default network status if not exists
    const networkStatus = this.db.prepare('SELECT * FROM network_status WHERE id = 1').get();
    if (!networkStatus) {
      this.db.prepare(`
        INSERT INTO network_status (id, is_online, last_checked)
        VALUES (1, FALSE, datetime('now'))
      `).run();
    }
  }

  // Pages CRUD operations
  public getPages(parentId?: string): Page[] {
    const query = parentId 
      ? 'SELECT * FROM pages WHERE parent_id = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM pages WHERE parent_id IS NULL ORDER BY updated_at DESC';
    
    const stmt = this.db.prepare(query);
    return parentId ? stmt.all(parentId) as Page[] : stmt.all() as Page[];
  }

  public getPage(id: string): Page | undefined {
    const stmt = this.db.prepare('SELECT * FROM pages WHERE id = ?');
    return stmt.get(id) as Page | undefined;
  }

  public createPage(page: Omit<Page, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Page {
    const now = new Date().toISOString();
    const newPage: Page = {
      ...page,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      server_updated_at: null
    };

    const stmt = this.db.prepare(`
      INSERT INTO pages (id, title, parent_id, user_id, is_favorite, type, created_at, updated_at, sync_status, server_updated_at)
      VALUES (@id, @title, @parent_id, @user_id, @is_favorite, @type, @created_at, @updated_at, @sync_status, @server_updated_at)
    `);
    
    stmt.run(newPage);
    
    // Add to sync log
    this.addToSyncLog('page', newPage.id, 'create', JSON.stringify(newPage));
    
    return newPage;
  }

  public updatePage(id: string, updates: Partial<Omit<Page, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Page | undefined {
    const page = this.getPage(id);
    if (!page) return undefined;

    const now = new Date().toISOString();
    const updatedPage: Page = {
      ...page,
      ...updates,
      updated_at: now,
      sync_status: 'pending'
    };

    const stmt = this.db.prepare(`
      UPDATE pages 
      SET title = @title, 
          parent_id = @parent_id, 
          is_favorite = @is_favorite, 
          type = @type, 
          updated_at = @updated_at,
          sync_status = @sync_status
      WHERE id = @id
    `);
    
    stmt.run(updatedPage);
    
    // Add to sync log
    this.addToSyncLog('page', updatedPage.id, 'update', JSON.stringify(updatedPage));
    
    return updatedPage;
  }

  public deletePage(id: string): void {
    const page = this.getPage(id);
    if (!page) return;

    // Add to sync log before deleting
    this.addToSyncLog('page', id, 'delete', JSON.stringify({ id }));
    
    const stmt = this.db.prepare('DELETE FROM pages WHERE id = ?');
    stmt.run(id);
  }

  // Blocks CRUD operations
  public getBlocks(pageId: string): Block[] {
    const stmt = this.db.prepare('SELECT * FROM blocks WHERE page_id = ? ORDER BY order_index ASC');
    return stmt.all(pageId) as Block[];
  }

  public getBlock(id: string): Block | undefined {
    const stmt = this.db.prepare('SELECT * FROM blocks WHERE id = ?');
    return stmt.get(id) as Block | undefined;
  }

  public createBlock(block: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Block {
    const now = new Date().toISOString();
    const newBlock: Block = {
      ...block,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      server_updated_at: null
    };

    const stmt = this.db.prepare(`
      INSERT INTO blocks (id, page_id, user_id, type, content, metadata, order_index, created_at, updated_at, sync_status, server_updated_at)
      VALUES (@id, @page_id, @user_id, @type, @content, @metadata, @order_index, @created_at, @updated_at, @sync_status, @server_updated_at)
    `);
    
    stmt.run(newBlock);
    
    // Add to sync log
    this.addToSyncLog('block', newBlock.id, 'create', JSON.stringify(newBlock));
    
    return newBlock;
  }

  public updateBlock(id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Block | undefined {
    const block = this.getBlock(id);
    if (!block) return undefined;

    const now = new Date().toISOString();
    const updatedBlock: Block = {
      ...block,
      ...updates,
      updated_at: now,
      sync_status: 'pending'
    };

    const stmt = this.db.prepare(`
      UPDATE blocks 
      SET type = @type, 
          content = @content, 
          metadata = @metadata, 
          order_index = @order_index, 
          updated_at = @updated_at,
          sync_status = @sync_status
      WHERE id = @id
    `);
    
    stmt.run(updatedBlock);
    
    // Add to sync log
    this.addToSyncLog('block', updatedBlock.id, 'update', JSON.stringify(updatedBlock));
    
    return updatedBlock;
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
  private addToSyncLog(entityType: 'page' | 'block', entityId: string, action: 'create' | 'update' | 'delete', payload: string): void {
    const now = new Date().toISOString();
    const id = `${entityType}_${entityId}_${now}`;
    
    const stmt = this.db.prepare(`
      INSERT INTO sync_log (id, entity_type, entity_id, action, status, payload, created_at)
      VALUES (@id, @entity_type, @entity_id, @action, @status, @payload, @created_at)
    `);
    
    stmt.run({
      id,
      entity_type: entityType,
      entity_id: entityId,
      action,
      status: 'pending',
      payload,
      created_at: now
    });
  }

  public getPendingSyncLogs(): SyncLog[] {
    const stmt = this.db.prepare('SELECT * FROM sync_log WHERE status = "pending" ORDER BY created_at ASC');
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

  // Network status operations
  public updateNetworkStatus(isOnline: boolean): void {
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE network_status 
      SET is_online = @is_online, 
          last_checked = @last_checked
      WHERE id = 1
    `);
    
    stmt.run({
      is_online: isOnline,
      last_checked: now
    });
  }

  public getNetworkStatus(): { is_online: boolean; last_checked: string } {
    const stmt = this.db.prepare('SELECT is_online, last_checked FROM network_status WHERE id = 1');
    return stmt.get() as { is_online: boolean; last_checked: string };
  }

  // Sync operations
  public markEntityAsSynced(entityType: 'page' | 'block', entityId: string, serverUpdatedAt: string): void {
    const table = entityType === 'page' ? 'pages' : 'blocks';
    
    const stmt = this.db.prepare(`
      UPDATE ${table} 
      SET sync_status = 'synced', 
          server_updated_at = @server_updated_at
      WHERE id = @id
    `);
    
    stmt.run({
      id: entityId,
      server_updated_at: serverUpdatedAt
    });
  }

  public markEntityAsConflict(entityType: 'page' | 'block', entityId: string): void {
    const table = entityType === 'page' ? 'pages' : 'blocks';
    
    const stmt = this.db.prepare(`
      UPDATE ${table} 
      SET sync_status = 'conflict'
      WHERE id = @id
    `);
    
    stmt.run({ id: entityId });
  }

  // Get all entities that need syncing
  public getEntitiesToSync(): { pages: Page[]; blocks: Block[] } {
    const pagesStmt = this.db.prepare('SELECT * FROM pages WHERE sync_status = "pending"');
    const blocksStmt = this.db.prepare('SELECT * FROM blocks WHERE sync_status = "pending"');
    
    return {
      pages: pagesStmt.all() as Page[],
      blocks: blocksStmt.all() as Block[]
    };
  }

  // Close the database connection
  public close(): void {
    this.db.close();
  }
}

export default DatabaseService;
