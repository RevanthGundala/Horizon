import { Client } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createHeaders, handleOptions } from '../utils/middleware';
import * as aws from "@pulumi/aws";
import { createClient } from "redis"; 
// Create a Redis client when needed, don't use global import
import crypto from 'crypto';

type EntityType = 'workspace' | 'note' | 'block';
type SyncAction = 'create' | 'update' | 'delete';

interface SyncChange {
  entity_type: EntityType;
  action: SyncAction;
  entity_id: string;
  data: any;
  client_updated_at: string;
}

interface SyncRequest {
  changes: SyncChange[];
  sync_token?: string;
}

interface SyncResponse {
  updates: Array<{
    entity_type: EntityType;
    entity_id: string;
    data: any;
    server_updated_at: string;
  }>;
  conflicts?: Array<{
    entity_type: EntityType;
    entity_id: string;
    server_version: any;
    client_version: any;
    errors?: string[];
    reason?: string;
  }>;
  sync_token: string;
}

interface Conflict {
  entity_type: EntityType;
  entity_id: string;
  server_version: any;
  client_version: any;
  errors?: string[];
  reason?: string;
}

interface CachedWorkspace {
  id: string;
  hash: string;
  lastSyncedAt: string;
}

interface WorkspaceHashResponse {
  mismatches: Array<{
    workspace_id: string;
    required_entities: Array<'note' | 'block' | 'workspace'>;
  }>;
  sync_token: string;
}

interface NoteWithChildren {
  id: string;
  parent_id?: string;
  children: NoteWithChildren[];
  blocks: any[];
}

// Whitelist of columns allowed for each entity type
const ALLOWED_COLUMNS: Record<EntityType, string[]> = {
  workspace: ['title', 'user_id'], 
  note: ['workspace_id', 'parent_id', 'title', 'content', 'is_favorite', 'type', 'user_id'],
  block: ['note_id', 'type', 'content', 'metadata', 'order_index', 'user_id']
};

const validateSyncRequest = (request: SyncRequest): string[] => {
  const errors: string[] = [];
  
  if (!request.changes || !Array.isArray(request.changes)) {
    errors.push('Invalid changes format');
    return errors;
  }
  
  request.changes.forEach((change, index) => {
    if (!['workspace', 'folder', 'note', 'block'].includes(change.entity_type)) {
      errors.push(`Change ${index}: Invalid entity_type`);
    }
    
    if (!['create', 'update', 'delete'].includes(change.action)) {
      errors.push(`Change ${index}: Invalid action`);
    }
    
    if (!change.entity_id || typeof change.entity_id !== 'string') {
      errors.push(`Change ${index}: Invalid entity_id`);
    }
    
    if (change.action !== 'delete' && !change.data) {
      errors.push(`Change ${index}: Missing data for non-delete action`);
    }
    
    if (!change.client_updated_at || isNaN(Date.parse(change.client_updated_at))) {
      errors.push(`Change ${index}: Invalid client_updated_at`);
    }
  });
  
  return errors;
};

const validateWorkspaceHierarchy = async (client: Client, change: SyncChange): Promise<string[]> => {
  const errors: string[] = [];
  
  if (change.entity_type === 'note' && !change.data.workspace_id) {
    errors.push('Note must belong to a workspace');
  }
  
  if (change.entity_type === 'block' && !change.data.note_id) {
    errors.push('Block must belong to a note');
  }
  
  return errors;
};

// A helper to sanitize data by whitelisting allowed columns
const sanitizeData = (entity_type: EntityType, data: any): any => {
  const allowed = ALLOWED_COLUMNS[entity_type];
  const sanitized: any = {};
  for (const key of allowed) {
    if (data.hasOwnProperty(key)) {
      sanitized[key] = data[key];
    }
  }
  return sanitized;
};

const handleCreate = async (client: Client, change: SyncChange, now: string) => {
  const table = change.entity_type + 's';
  const sanitizedData = sanitizeData(change.entity_type, change.data);
  const columns = Object.keys(sanitizedData);
  
  const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
  const query = `
    INSERT INTO ${table} (id, ${columns.join(', ')}, created_at, updated_at)
    VALUES ($1, ${placeholders}, $${columns.length + 2}, $${columns.length + 3})
    RETURNING *`;
  const values = [change.entity_id, ...Object.values(sanitizedData), now, now];
  const result = await client.query(query, values);
  return {
    entity_type: change.entity_type,
    entity_id: change.entity_id,
    data: result.rows[0],
    server_updated_at: now
  };
};

const handleUpdate = async (client: Client, change: SyncChange, now: string) => {
  const table = change.entity_type + 's';
  const sanitizedData = sanitizeData(change.entity_type, change.data);
  const columns = Object.keys(sanitizedData);
  
  if (columns.length === 0) {
    // Nothing to update
    return null;
  }
  
  const setClause = columns.map((key, i) => `${key} = $${i + 1}`).join(', ');
  // Use optimistic concurrency control: only update if the current updated_at equals the client's client_updated_at.
  const query = `
    UPDATE ${table}
    SET ${setClause}, updated_at = $${columns.length + 1}
    WHERE id = $${columns.length + 2} AND updated_at = $${columns.length + 3}
    RETURNING *`;
  const values = [...Object.values(sanitizedData), now, change.entity_id, change.client_updated_at];
  const result = await client.query(query, values);
  if (result.rows.length > 0) {
    return {
      entity_type: change.entity_type,
      entity_id: change.entity_id,
      data: result.rows[0],
      server_updated_at: now
    };
  }
  return null;
};

const handleDelete = async (client: Client, change: SyncChange) => {
  const table = change.entity_type + 's';
  await client.query(`DELETE FROM ${table} WHERE id = $1`, [change.entity_id]);
};

/**
 * Computes a workspace hash using a Merkle tree structure
 * This method is identical to the client-side implementation to ensure hash consistency
 */
const computeWorkspaceHash = async (client: Client, workspaceId: string): Promise<string> => {
  // Get workspace metadata
  const workspaceRes = await client.query(
    'SELECT id, title, updated_at FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  
  if (workspaceRes.rows.length === 0) return '';
  const workspace = workspaceRes.rows[0];
  
  // Get all notes in the workspace (with hierarchy)
  const notesRes = await client.query(
    'SELECT id, title, parent_id, updated_at FROM notes WHERE workspace_id = $1',
    [workspaceId]
  );
  const notes = notesRes.rows;
  
  // Build note tree
  const noteTree = buildNoteTree(notes);
  
  // Compute note hashes recursively - using an identical algorithm to the client
  const computeNoteHash = async (note: any): Promise<string> => {
    // Get blocks for this note
    const blocksRes = await client.query(
      'SELECT id, type, content, updated_at, order_index FROM blocks WHERE note_id = $1 ORDER BY order_index',
      [note.id]
    );
    const blocks = blocksRes.rows;
    
    // Compute block hashes
    const blockHashes = blocks
      .map(block => {
        const blockData = `${block.id}|${block.type}|${block.content}|${block.updated_at}`;
        return crypto.createHash('sha256').update(blockData).digest('hex');
      })
      .join('');
    
    // Compute child note hashes
    const childHashPromises = note.children.map(computeNoteHash);
    const childHashes = (await Promise.all(childHashPromises)).join('');
    
    // Combine with note data and hash
    const noteData = `${note.id}|${note.title}|${note.updated_at}|${blockHashes}|${childHashes}`;
    return crypto.createHash('sha256').update(noteData).digest('hex');
  };
  
  // Compute all root note hashes and combine
  const noteHashPromises = noteTree.map(computeNoteHash);
  const noteHashes = (await Promise.all(noteHashPromises)).join('');
  
  // Compute overall workspace hash
  const workspaceData = `${workspace.id}|${workspace.title}|${workspace.updated_at}|${noteHashes}`;
  return crypto.createHash('sha256').update(workspaceData).digest('hex');
};

// Helper function to build note tree hierarchy
const buildNoteTree = (notes: any[]): any[] => {
  const noteMap = new Map();
  
  // Create map of all notes
  notes.forEach(note => {
    noteMap.set(note.id, { ...note, children: [] });
  });
  
  // Build hierarchy
  const roots: any[] = [];
  noteMap.forEach(note => {
    if (note.parent_id && noteMap.has(note.parent_id)) {
      noteMap.get(note.parent_id).children.push(note);
    } else {
      roots.push(note);
    }
  });
  
  return roots;
};

const applyChanges = async (client: Client, request: SyncRequest): Promise<SyncResponse> => {
  const now = new Date().toISOString();
  const updates: Array<{
    entity_type: EntityType;
    entity_id: string;
    data: any;
    server_updated_at: string;
  }> = [];
  const conflicts: Conflict[] = [];
  
  // Collect workspace IDs that need their hash updated
  const workspacesToUpdate = new Set<string>();
  
  await client.query('BEGIN');
  
  try {
    for (const change of request.changes) {
      const hierarchyErrors = await validateWorkspaceHierarchy(client, change);
      if (hierarchyErrors.length > 0) {
        conflicts.push({
          entity_type: change.entity_type,
          entity_id: change.entity_id,
          server_version: null,
          client_version: change.data,
          errors: hierarchyErrors
        });
        continue;
      }
      
      let result;
      switch (change.action) {
        case 'create':
          result = await handleCreate(client, change, now);
          updates.push(result);
          break;
        case 'update':
          result = await handleUpdate(client, change, now);
          if (result) {
            updates.push(result);
          } else {
            conflicts.push({
              entity_type: change.entity_type,
              entity_id: change.entity_id,
              server_version: null,
              client_version: change.data,
              errors: ['Conflict detected during update']
            });
          }
          break;
        case 'delete':
          await handleDelete(client, change);
          break;
      }
      
      // Mark the related workspace for hash update.
      // If the entity is a workspace, use the entity_id.
      // For notes, we expect a workspace_id in the data.
      // For blocks, fetch the note to find its workspace_id
      let workspaceId: string | undefined;
      if (change.entity_type === 'workspace') {
        workspaceId = change.entity_id;
      } else if (change.entity_type === 'note' && change.data.workspace_id) {
        workspaceId = change.data.workspace_id;
      } else if (change.entity_type === 'block' && change.data.note_id) {
        // Look up the note to find its workspace
        const noteResult = await client.query(
          'SELECT workspace_id FROM notes WHERE id = $1',
          [change.data.note_id]
        );
        if (noteResult.rows.length > 0) {
          workspaceId = noteResult.rows[0].workspace_id;
        }
      }
      if (workspaceId) {
        workspacesToUpdate.add(workspaceId);
      }
    }
    
    await client.query('COMMIT');
    
    // After committing, update workspace hashes for each affected workspace.
    for (const workspaceId of workspacesToUpdate) {
      const newHash = await computeWorkspaceHash(client, workspaceId);
      await updateWorkspaceHash(workspaceId, newHash);
    }
    
    return { updates, conflicts, sync_token: uuidv4() };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

// Workspace hash management via Redis
const getWorkspaceHashes = async (workspaceIds: string[]): Promise<Record<string, CachedWorkspace>> => {
  if (workspaceIds.length === 0) return {};
  
  try {
    // Create Redis client
    const redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
    
    const results = await Promise.all(
      workspaceIds.map(id => redisClient.get(`workspace:${id}`))
    );
    
    // Close Redis connection
    await redisClient.disconnect();
    
    return workspaceIds.reduce((acc, id, index) => {
      if (results[index]) {
        acc[id] = JSON.parse(results[index] as string);
      }
      return acc;
    }, {} as Record<string, CachedWorkspace>);
  } catch (error) {
    console.error('Error getting workspace hashes from Redis:', error);
    return {};
  }
};

const updateWorkspaceHash = async (workspaceId: string, hash: string): Promise<void> => {
  try {
    // Create Redis client
    const redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
    
    const cached: CachedWorkspace = {
      id: workspaceId,
      hash,
      lastSyncedAt: new Date().toISOString()
    };
    
    await redisClient.set(
      `workspace:${workspaceId}`,
      JSON.stringify(cached),
      { EX: 86400 } // Expire after 1 day
    );
    
    // Close Redis connection
    await redisClient.disconnect();
  } catch (error) {
    console.error('Error updating workspace hash in Redis:', error);
  }
};

const compareWorkspaceHashes = async (clientHashes: Record<string, string>): Promise<WorkspaceHashResponse> => {
  const workspaceIds = Object.keys(clientHashes);
  const serverHashes = await getWorkspaceHashes(workspaceIds);
  
  const mismatches: WorkspaceHashResponse['mismatches'] = [];
  
  for (const [workspaceId, clientHash] of Object.entries(clientHashes)) {
    const serverHash = serverHashes[workspaceId]?.hash;
    
    if (!serverHash || serverHash !== clientHash) {
      mismatches.push({
        workspace_id: workspaceId,
        required_entities: ['workspace', 'note', 'block'] // Initiate a full sync for mismatches
      });
    }
  }
  
  return {
    mismatches,
    sync_token: uuidv4()
  };
};

const getAllNotes = async (workspaceId: string): Promise<any[]> => {
  try {
    // Create Redis client
    const redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
    
    const res = await redisClient.get(`notes:${workspaceId}`);
    
    // Close Redis connection
    await redisClient.disconnect();
    
    if (res) {
      return JSON.parse(res as string);
    }
    return [];
  } catch (error) {
    console.error('Error getting notes from Redis:', error);
    return [];
  }
};

const getBlocksForWorkspace = async (workspaceId: string): Promise<any[]> => {
  try {
    // Create Redis client
    const redisClient = createClient({ url: process.env.REDIS_URL });
    await redisClient.connect();
    
    const res = await redisClient.get(`blocks:${workspaceId}`);
    
    // Close Redis connection
    await redisClient.disconnect();
    
    if (res) {
      return JSON.parse(res as string);
    }
    return [];
  } catch (error) {
    console.error('Error getting blocks from Redis:', error);
    return [];
  }
};

async function getNotesWithHierarchy(workspaceId: string): Promise<NoteWithChildren[]> {
  const notes = await getAllNotes(workspaceId);
  const blocks = await getBlocksForWorkspace(workspaceId);
  
  const noteMap = new Map<string, NoteWithChildren>();
  
  // Create note map with blocks
  notes.forEach(note => {
    noteMap.set(note.id, {
      ...note,
      children: [],
      blocks: blocks.filter(b => b.note_id === note.id)
    });
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

/**
 * Check status of workspace hashes to identify changes (like git status)
 */
const handleSyncStatus = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }
  
  try {
    const { workspace_hashes } = JSON.parse(event.body || '{}');
    
    if (!workspace_hashes || typeof workspace_hashes !== 'object') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid workspace_hashes parameter' }),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    }
    
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      const response = await compareWorkspaceHashes(workspace_hashes);
      return {
        statusCode: 200,
        body: JSON.stringify(response),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Error in sync status:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error comparing workspace hashes' }),
      headers: createHeaders(event.headers.origin || event.headers.Origin || '')
    };
  }
};

/**
 * Pull changes from server to client (like git pull)
 */
const handleSyncPull = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }
  
  try {
    const { workspace_id, include_blocks = true } = JSON.parse(event.body || '{}');
    
    if (!workspace_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing workspace_id parameter' }),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    }
    
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      
      // Get workspace
      const workspaceQuery = await client.query(
        'SELECT * FROM workspaces WHERE id = $1',
        [workspace_id]
      );
      
      if (workspaceQuery.rows.length === 0) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Workspace not found' }),
          headers: createHeaders(event.headers.origin || event.headers.Origin || '')
        };
      }
      
      const workspace = workspaceQuery.rows[0];
      
      // Get notes in the workspace
      const notesQuery = await client.query(
        'SELECT * FROM notes WHERE workspace_id = $1',
        [workspace_id]
      );
      
      let blocks = [];
      if (include_blocks) {
        // Get blocks for all notes in the workspace
        const noteIds = notesQuery.rows.map(note => note.id);
        if (noteIds.length > 0) {
          const blocksQuery = await client.query(
            'SELECT * FROM blocks WHERE note_id = ANY($1) ORDER BY order_index',
            [noteIds]
          );
          blocks = blocksQuery.rows;
        }
      }
      
      // Compute hash for future reference
      const hash = await computeWorkspaceHash(client, workspace_id);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          workspace,
          notes: notesQuery.rows,
          blocks: include_blocks ? blocks : [],
          hash
        }),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Error in sync pull:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error pulling workspace data' }),
      headers: createHeaders(event.headers.origin || event.headers.Origin || '')
    };
  }
};

/**
 * Push changes from client to server (like git push)
 */
const handleSyncPush = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }
  
  try {
    const request: SyncRequest = JSON.parse(event.body || '{}');
    
    const validationErrors = validateSyncRequest(request);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ errors: validationErrors }),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    }
    
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      const result = await applyChanges(client, request);
      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: createHeaders(event.headers.origin || event.headers.Origin || '')
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('Error in sync push:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error applying changes' }),
      headers: createHeaders(event.headers.origin || event.headers.Origin || '')
    };
  }
};

// Process entity changes to generate embeddings
const generateEmbeddingsForChanges = async (changes: Array<SyncChange>): Promise<void> => {
  const client = new Client({
    connectionString: process.env.DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    
    // Import embedding utils
    const { storeNoteEmbedding, storeBlockEmbedding } = await import('../utils/embedding');
    
    // Process notes
    const noteChanges = changes.filter(c => 
      c.entity_type === 'note' && 
      (c.action === 'create' || c.action === 'update')
    );
    
    for (const change of noteChanges) {
      try {
        const note = change.data;
        const textToEmbed = `${note.title}\n\n${note.content || ''}`.trim();
        
        if (textToEmbed) {
          await storeNoteEmbedding(note.id, note.user_id, note.title, note.content);
          console.log(`Generated embedding for note ${note.id}`);
        }
      } catch (error) {
        console.error(`Error generating embedding for note ${change.entity_id}:`, error);
      }
    }
    
    // Process blocks
    const blockChanges = changes.filter(c => 
      c.entity_type === 'block' && 
      (c.action === 'create' || c.action === 'update')
    );
    
    for (const change of blockChanges) {
      try {
        const block = change.data;
        if (block.content && block.content.trim()) {
          await storeBlockEmbedding(block.id, block.content);
          console.log(`Generated embedding for block ${block.id}`);
        }
      } catch (error) {
        console.error(`Error generating embedding for block ${change.entity_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error generating embeddings for changes:', error);
  } finally {
    await client.end();
  }
};

export const syncApi = {
  status: handleSyncStatus,
  pull: handleSyncPull,
  push: async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const result = await handleSyncPush(event);
    
    // If the push was successful, generate embeddings for the changes
    if (result.statusCode === 200) {
      try {
        const body = JSON.parse(event.body || '{}');
        if (body.changes && Array.isArray(body.changes)) {
          // Process embeddings in the background (don't await)
          generateEmbeddingsForChanges(body.changes)
            .catch(error => console.error('Background embedding generation failed:', error));
        }
      } catch (error) {
        console.error('Error processing changes for embedding generation:', error);
      }
    }
    
    return result;
  }
};
