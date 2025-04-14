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
    `,
    CHAT_MESSAGES: `
      CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          -- Link to a chat session/thread if you have that concept, otherwise maybe link to a workspace/note?
          -- For simplicity, let's assume a 'thread_id' exists. Add a threads table if needed.
          thread_id TEXT NOT NULL DEFAULT 'default_thread',
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), -- Who sent the message
          content TEXT NOT NULL, -- The message text
          timestamp TEXT NOT NULL, -- When the message was created/received (ISO 8601 format)
          user_id TEXT, -- Optional: Which user sent/received this

          -- Fields for Hybrid Sync & Offline First
          sync_status TEXT NOT NULL DEFAULT 'local' CHECK(sync_status IN ('local', 'sending_stream', 'sending_batch', 'synced', 'error')), -- Sync state
          server_message_id TEXT UNIQUE DEFAULT NULL, -- ID from the backend AI/service (optional)
          error_message TEXT DEFAULT NULL, -- Store sync error details
          retry_count INTEGER NOT NULL DEFAULT 0, -- Track background sync retries
          related_user_message_id TEXT DEFAULT NULL, -- Link assistant response to the user message ID that triggered it

          -- Optional Foreign Key (adjust based on your actual thread table)
          -- FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Index for faster querying of messages by thread
      CREATE INDEX IF NOT EXISTS chat_messages_thread_timestamp_idx ON chat_messages (thread_id, timestamp);
      -- Index for background sync process
      CREATE INDEX IF NOT EXISTS chat_messages_sync_status_idx ON chat_messages (sync_status, retry_count, timestamp);
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