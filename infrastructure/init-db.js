const { Client } = require("pg");

// Supabase connection details
const password = "zisbas-roCfud-9kappe";
const connectionString = `postgresql://postgres.wduhigsetfxsisltbjhr:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

const client = new Client({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function init() {
  try {
    await client.connect();

    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    // await client.query(`CREATE EXTENSION IF NOT EXISTS "pgvector";`);

    // Drop existing tables if they exist (in reverse order of dependencies)
    await client.query(`DROP TABLE IF EXISTS embeddings CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS records CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS databases CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS sync_log CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS blocks CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS notes CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS folders CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS workspaces CASCADE;`);
    await client.query(`DROP TABLE IF EXISTS users CASCADE;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
        folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT false,
        type TEXT DEFAULT 'note',
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        sync_status TEXT DEFAULT 'synced',
        client_updated_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT,
        metadata JSONB,
        order_index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        sync_status TEXT DEFAULT 'synced',
        client_updated_at TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        synced_at TIMESTAMP,
        error_message TEXT,
        device_id TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        embedding VECTOR(1536),
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS embeddings_vector_idx 
      ON embeddings USING ivfflat (embedding vector_l2_ops) 
      WITH (lists = 100);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS databases (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        note_id UUID REFERENCES notes(id),
        user_id TEXT REFERENCES users(id),
        name TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        database_id UUID REFERENCES databases(id),
        values JSONB
      );
    `);

    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ Error initializing database:", err);
  } finally {
    await client.end();
  }
}

init();
