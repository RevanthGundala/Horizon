export const SQL_SCHEMAS = {
    USERS: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
    `,
  
    WORKSPACES: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_favorite INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT
      );
    `,
  
    NOTES: `
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL,
        content TEXT,
        is_favorite INTEGER DEFAULT 0,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CHECK (parent_id IS NULL OR parent_id != id)
      );
      CREATE INDEX IF NOT EXISTS notes_parent_id_idx ON notes(parent_id);
    `,
  
    BLOCKS: `
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'synced',
        server_updated_at TEXT,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `,
  
    SYNC_LOG: `
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
    `
  };

// PostgreSQL-specific schemas (for backend)
export const PG_SCHEMAS = {
    // Enable pgvector extension
    ENABLE_VECTOR: `
      CREATE EXTENSION IF NOT EXISTS vector;
    `,
  
    // Create embeddings table for notes
    NOTE_EMBEDDINGS: `
      CREATE TABLE IF NOT EXISTS note_embeddings (
        id SERIAL PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        embedding vector(1536),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(note_id)
      );
      CREATE INDEX IF NOT EXISTS note_embeddings_note_id_idx ON note_embeddings(note_id);
    `,
  
    // Create embeddings table for blocks
    BLOCK_EMBEDDINGS: `
      CREATE TABLE IF NOT EXISTS block_embeddings (
        id SERIAL PRIMARY KEY,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        embedding vector(1536),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(block_id)
      );
      CREATE INDEX IF NOT EXISTS block_embeddings_block_id_idx ON block_embeddings(block_id);
    `,
  
    // Create vector indexes for similarity search
    VECTOR_INDEXES: `
      CREATE INDEX IF NOT EXISTS note_embeddings_vector_idx ON note_embeddings 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
      
      CREATE INDEX IF NOT EXISTS block_embeddings_vector_idx ON block_embeddings 
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    `
  };