"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDbHandler = void 0;
const pg_1 = require("pg");
const initDbHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Connect to the database using environment variables
        const client = new pg_1.Client({
            host: process.env.DB_HOST,
            port: 5432,
            database: process.env.DB_NAME || "postgres",
            user: process.env.DB_USER || "postgres",
            password: process.env.DB_PASSWORD,
            ssl: {
                rejectUnauthorized: false
            }
        });
        yield client.connect();
        // Initialize database schema
        yield client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
        yield client.query(`CREATE EXTENSION IF NOT EXISTS "pgvector";`);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS pages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES pages(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT false,
        type TEXT DEFAULT 'page',
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        content TEXT,
        metadata JSONB,
        order_index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        embedding VECTOR(1536),
        created_at TIMESTAMP DEFAULT now()
      );
    `);
        yield client.query(`
      CREATE INDEX IF NOT EXISTS embeddings_vector_idx 
      ON embeddings USING ivfflat (embedding vector_l2_ops) 
      WITH (lists = 100);
    `);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS databases (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        page_id UUID REFERENCES pages(id),
        user_id UUID REFERENCES users(id),
        name TEXT
      );
    `);
        yield client.query(`
      CREATE TABLE IF NOT EXISTS records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        database_id UUID REFERENCES databases(id),
        values JSONB
      );
    `);
        yield client.end();
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: "Database initialized successfully"
            }),
        };
    }
    catch (error) {
        console.error("Error initializing database:", error);
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: "Error initializing database",
                error: error instanceof Error ? error.message : String(error),
            }),
        };
    }
});
exports.initDbHandler = initDbHandler;
//# sourceMappingURL=init-db.js.map