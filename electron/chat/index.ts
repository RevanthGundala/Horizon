import Database from 'better-sqlite3';

import DatabaseService from '../data';

// Define an interface for clarity
interface ChatMessageInput {
    id: string;
    threadId: string;
    role: 'user' | 'assistant';
    content: string;
    userId?: string | null;
    timestamp?: string; // ISO String preferred
    syncStatus?: 'local' | 'sending_stream' | 'sending_batch' | 'synced' | 'error';
    relatedUserMessageId?: string | null;
    serverMessageId?: string | null;
    errorMessage?: string | null;
}

interface ChatMessageRecord extends ChatMessageInput {
    timestamp: string; // Non-optional after DB insert
    // Add other DB fields like created_at, updated_at if they exist
}


export class ChatService {
    private db: Database.Database;
    private static instance: ChatService;
    // ... constructor, getInstance, other methods ...
    constructor() {
        this.db = DatabaseService.getInstance().getDb();
    }

    public static getInstance(): ChatService {
        if (!ChatService.instance) {
            ChatService.instance = new ChatService();
        }
        return ChatService.instance;
    }
    
    /**
     * Adds a new chat message or replaces an existing one by ID.
     * Returns the final record as stored in the DB.
     */
    upsertChatMessage(message: ChatMessageInput): ChatMessageRecord {
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO chat_messages (
                id, thread_id, role, content, user_id, timestamp,
                sync_status, related_user_message_id, server_message_id, error_message
                -- Add created_at, updated_at if needed
            ) VALUES (
                @id, @threadId, @role, @content, @userId, @timestamp,
                @syncStatus, @relatedUserMessageId, @serverMessageId, @errorMessage
            )
            ON CONFLICT(id) DO UPDATE SET
                thread_id = excluded.thread_id,
                role = excluded.role,
                content = excluded.content,
                user_id = excluded.user_id,
                timestamp = excluded.timestamp, -- Or keep original timestamp? Decide based on need
                sync_status = excluded.sync_status,
                related_user_message_id = excluded.related_user_message_id,
                server_message_id = excluded.server_message_id,
                error_message = excluded.error_message,
                retry_count = CASE WHEN excluded.sync_status = 'error' THEN retry_count ELSE 0 END -- Reset retries if not error
                -- updated_at = CURRENT_TIMESTAMP
            RETURNING * -- Return the inserted or updated row
        `);

        const record: ChatMessageRecord = stmt.get({
            id: message.id,
            threadId: message.threadId,
            role: message.role,
            content: message.content,
            userId: message.userId || null,
            timestamp: message.timestamp || now,
            syncStatus: message.syncStatus || 'local',
            relatedUserMessageId: message.relatedUserMessageId || null,
            serverMessageId: message.serverMessageId || null,
            errorMessage: message.errorMessage || null
        }) as ChatMessageRecord;

        if (!record) {
            throw new Error(`Failed to upsert chat message ${message.id}`);
        }
        // Ensure timestamp is always set correctly in the returned object
        record.timestamp = message.timestamp || now;
        return record;
    }


    /**
     * Updates only the status, error message, and potentially retry count of a message.
     */
    updateChatMessageStatus(id: string, status: string, errorMsg?: string | null, incrementRetry: boolean = false) {
        const params: any = { status: status, error_message: errorMsg || null, id: id };
        let sql = `UPDATE chat_messages SET sync_status = @status, error_message = @error_message`;

        if (incrementRetry) {
            sql += `, retry_count = retry_count + 1`;
        }
        // Optionally update timestamp
        // sql += `, updated_at = CURRENT_TIMESTAMP`;

        sql += ` WHERE id = @id`;

        const stmt = this.db.prepare(sql);
        const info = stmt.run(params);
        console.log(`[DB updateChatMessageStatus] Updated message ${id} status to ${status}. Rows affected: ${info.changes}`);
    }

    /**
     * Updates the content of an existing assistant message (e.g., after stream completion).
     * Also marks it as synced.
     */
     finalizeAssistantMessageContent(id: string, finalContent: string, serverId?: string | null) {
         const stmt = this.db.prepare(`
            UPDATE chat_messages
            SET content = ?, sync_status = 'synced', server_message_id = ?, error_message = NULL, retry_count = 0
            WHERE id = ? AND role = 'assistant'
         `);
         const info = stmt.run(finalContent, serverId || null, id);
         console.log(`[DB finalizeAssistantMessage] Finalized content for ${id}. Rows affected: ${info.changes}`);
     }

    /**
     * Marks a user message as synced (e.g., after successful stream or batch sync).
     */
    markUserMessageSynced(id: string, timestamp?: string | null) {
        const stmt = this.db.prepare(`
            UPDATE chat_messages
            SET sync_status = 'synced', error_message = NULL, retry_count = 0
            WHERE id = ? AND role = 'user'
        `);
        stmt.run(id);
         console.log(`[DB markUserMessageSynced] Marked user message ${id} as synced.`);
    }

    /**
     * Gets all messages for a specific thread, ordered by time.
     */
    getChatMessages(threadId: string): ChatMessageRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM chat_messages
            WHERE thread_id = ? ORDER BY timestamp ASC
        `);
        return stmt.all(threadId) as ChatMessageRecord[];
    }

    /**
     * Finds user messages that need an AI response via background sync.
     */
    getPendingAiRequests(limit: number = 5): ChatMessageRecord[] {
        const stmt = this.db.prepare(`
            SELECT * FROM chat_messages
            WHERE role = 'user'
              AND sync_status IN ('local', 'error', 'sending_stream') -- Pick up local, failed, or maybe stuck stream attempts
              AND retry_count < 5 -- Limit retries
            ORDER BY timestamp ASC
            LIMIT ?
        `);
        return stmt.all(limit) as ChatMessageRecord[];
    }

     /**
      * Gets recent message history for providing context to the AI.
      */
     getMessageHistoryForContext(threadId: string, limit: number = 10): { role: 'user' | 'assistant'; content: string }[] {
        const stmt = this.db.prepare(`
            SELECT role, content FROM chat_messages
            WHERE thread_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        // Reverse the order after fetching so it's chronological
        const messages = stmt.all(threadId, limit);
        return messages.reverse() as { role: 'user' | 'assistant'; content: string }[];
    }

}