#!/usr/bin/env node

import pkg from 'pg';
const { Client } = pkg;
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Since this script is run from the infrastructure directory, we need to use the correct path
// to reach the shared directory which is at the project root
// Since the script is in infrastructure/scripts, we need to go up two directories
const sqlSchemasPath = path.resolve(__dirname, '../../shared/sql-schemas.ts');

// Read the TypeScript file as a string
const sqlSchemaContent = fs.readFileSync(sqlSchemasPath, 'utf8');

// Extract SQL_SCHEMAS using a regex approach since we can't directly require a TypeScript file
// This is a simple solution - in a production environment, we'd compile TS to JS first
function extractSqlSchemas(content) {
  // Match everything between SQL_SCHEMAS = { ... };
  const schemaMatch = content.match(/SQL_SCHEMAS\s*=\s*{([\s\S]*?)};/);
  if (!schemaMatch) {
    throw new Error('Could not find SQL_SCHEMAS in the file');
  }
  
  // Get the schemas content
  const schemasText = schemaMatch[1];
  
  // Extract each schema (this is a simplified approach)
  const schemaMatches = schemasText.match(/[A-Z_]+:\s*`([\s\S]*?)`/g);
  
  if (!schemaMatches) {
    throw new Error('Could not parse SQL schemas');
  }
  
  // Create the SQL_SCHEMAS object
  const SQL_SCHEMAS = {};
  
  // Parse each schema
  for (const schemaMatch of schemaMatches) {
    // Extract the key and value
    const keyMatch = schemaMatch.match(/([A-Z_]+):/);
    const valueMatch = schemaMatch.match(/`([\s\S]*?)`/);
    
    if (keyMatch && valueMatch) {
      const key = keyMatch[1];
      const value = valueMatch[1];
      SQL_SCHEMAS[key] = value;
    }
  }
  
  return SQL_SCHEMAS;
}

// Get the SQL_SCHEMAS object
const SQL_SCHEMAS = extractSqlSchemas(sqlSchemaContent);

console.log('Loaded SQL schemas:', Object.keys(SQL_SCHEMAS).join(', '));

// DB Connection details
// These would come from environment variables in production
const password = "zisbas-roCfud-9kappe";
const connectionString = `postgresql://postgres.wduhigsetfxsisltbjhr:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

async function initDatabase() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log("🔷 Connected to database, initializing schema...");

    // Deleting existing tables
    // Deleting existing tables - in reverse dependency order
await client.query('DROP TABLE IF EXISTS sync_log CASCADE');
await client.query('DROP TABLE IF EXISTS blocks CASCADE'); 
await client.query('DROP TABLE IF EXISTS notes CASCADE');
await client.query('DROP TABLE IF EXISTS workspaces CASCADE');
await client.query('DROP TABLE IF EXISTS users CASCADE');
    
    // Execute schema creation queries
    console.log("🔷 Creating users table...");
    await client.query(SQL_SCHEMAS.USERS);
    
    console.log("🔷 Creating workspaces table...");
    await client.query(SQL_SCHEMAS.WORKSPACES);
    
    console.log("🔷 Creating notes table...");
    await client.query(SQL_SCHEMAS.NOTES);
    
    console.log("🔷 Creating blocks table...");
    await client.query(SQL_SCHEMAS.BLOCKS);
    
    console.log("🔷 Creating sync_log table...");
    await client.query(SQL_SCHEMAS.SYNC_LOG);
    
    console.log("✅ Database initialized successfully");
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
    process.exit(1);
  } finally {
    await client.end();
    console.log("🔷 Database connection closed");
  }
}

// Run the initialization
initDatabase().then(() => {
  console.log("✨ Database initialization completed");
}).catch(err => {
  console.error("Fatal error during initialization:", err);
  process.exit(1);
});