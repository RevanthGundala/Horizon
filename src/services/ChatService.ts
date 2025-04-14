// services/chatService.ts (or wherever you keep frontend services)

import { ipcCall, isElectron } from '../utils/helpers'; // Assuming you have these helpers

// Interface defining chat operations available to the frontend
export interface ChatService {
    /**
     * Fetches all messages for a given chat thread from the local DB.
     * @param threadId - The ID of the chat thread.
     * @returns A promise resolving to an array of message records.
     */
    getMessages(threadId: string): Promise<ChatMessageRecord[]>;

    /**
     * Sends a user message. Saves it locally and initiates the AI response stream/background task.
     * Does NOT return the AI response directly. Listeners must be used for that.
     * @param messageData - Object containing threadId and content.
     * @returns A promise resolving to an object indicating success, the assigned message ID, and timestamp.
     */
    sendMessage(messageData: { threadId: string; content: string }): Promise<{ success: boolean; messageId?: string; timestamp?: string; error?: string }>;

    // Optional: Could add methods to create/list threads if needed
    // getThreads(): Promise<Thread[]>;
    // createThread(name?: string): Promise<Thread>;
}

// Implementation using IPC
export const chatService: ChatService = {
    getMessages: async (threadId: string): Promise<ChatMessageRecord[]> => {
        console.log(`[ChatService] Getting messages for thread: ${threadId}`);
        if (!isElectron()) {
            console.warn('ChatService: Not running in Electron. Returning empty messages.');
            return []; // Return empty array or mock data for browser mode
        }
        try {
            // Ensure the main process returns the correct type (or cast carefully)
            const messages = await ipcCall<ChatMessageRecord[]>('chat:get-messages', threadId);
            return messages || [];
        } catch (error) {
            console.error(`[ChatService] Error getting messages for thread ${threadId}:`, error);
            throw error; // Re-throw or return empty array
        }
    },

    sendMessage: async (messageData: { threadId: string; content: string }): Promise<{ success: boolean; messageId?: string; timestamp?: string; error?: string }> => {
        console.log(`[ChatService] Sending message to thread: ${messageData.threadId}`);
        if (!isElectron()) {
            console.warn('ChatService: Not running in Electron. Mock send.');
            // Simulate success for browser mode if needed
            return { success: true, messageId: `local-${Date.now()}`, timestamp: new Date().toISOString() };
        }
        try {
            // This invokes the handler that saves locally and starts the stream/background task
            const result = await ipcCall<{ success: boolean; messageId?: string; timestamp?: string; error?: string }>(
                'chat:send-user-message',
                messageData
            );
            return result; // Result indicates if the *initiation* was successful
        } catch (error: any) {
            console.error(`[ChatService] Error sending message:`, error);
            // Return error structure matching expected Promise type
            return { success: false, error: error.message || 'Failed to send message via IPC' };
        }
    },
};

// Type definition (adjust based on your actual DB schema/types)
// You might want this in a shared types file
export interface ChatMessageRecord {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO String from DB
  userId?: string | null;
  syncStatus?: string;
  serverMessageId?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
  relatedUserMessageId?: string | null;
}