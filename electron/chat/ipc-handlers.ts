// Create new file: chat/ipc-handlers.ts

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '../auth'; // Adjust path
import { ChatService } from './index'; // Adjust path
import { getMainWindowWebContents } from '../main';

const authService = AuthService.getInstance();
const chatService = ChatService.getInstance();

export function setupChatIpcHandlers(): void {

    ipcMain.handle('chat:send-user-message', async (event, messageData: { threadId: string; content: string }) => {
        console.log('[IPC chat:send-user-message] Received:', messageData);
        const mainWindow = getMainWindowWebContents(); // Get webContents
        const userId = authService.getUserId();
        if (!userId || !mainWindow) {
            console.error('[IPC chat:send-user-message] Auth/Window Error. UserID:', userId, 'Window:', !!mainWindow);
            return { success: false, error: 'User not authenticated or window not found' };
        }

        const messageId = uuidv4();
        let savedMessageTimestamp: string | undefined;

        try {
            // Save user message locally immediately
             const savedInfo = chatService.upsertChatMessage({ // Use upsert
                id: messageId,
                threadId: messageData.threadId,
                role: 'user',
                content: messageData.content,
                userId: userId,
                syncStatus: 'sending_stream' // Mark as attempting stream
            });
            savedMessageTimestamp = savedInfo.timestamp;
            console.log(`[IPC chat:send-user-message] User message ${messageId} saved locally.`);

            // --- Attempt Streaming Response ---
            const chatUrl = process.env.CHAT_URL || '';
            if (!chatUrl) {
                 console.error("CHAT_URL is not configured. Cannot attempt streaming.");
                 chatService.updateChatMessageStatus(messageId, 'error', 'Chat URL not configured'); // Fallback status
                throw new Error("Chat URL not configured");
            }

           // --- MODIFIED AUTHENTICATION CHECK ---
// Check the current authentication state known by AuthService
if (!authService.isAuthenticated()) {
    // Handle the case where the Electron app knows the user isn't authenticated
    console.error("Not authenticated according to AuthService state. Aborting chat request.");
    chatService.updateChatMessageStatus(messageId, 'error', 'Not Authenticated');
    throw new Error("Not authenticated for streaming");
} 

            const messageHistory = chatService.getMessageHistoryForContext(messageData.threadId);
             // Ensure the current user message isn't duplicated in history if context includes it
            const historyWithoutCurrent = messageHistory.filter(m => !(m.role === 'user' && m.content === messageData.content));
            historyWithoutCurrent.push({ role: 'user', content: messageData.content });

            const abortController = new AbortController();
            const timeoutId = setTimeout(() => abortController.abort(), 30000);

            console.log(`[IPC chat:send-user-message] Attempting stream fetch to ${chatUrl}`);
            const response = await fetch(chatUrl, { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: historyWithoutCurrent,
                }),
                credentials: 'include'
            }); // As defined before

            clearTimeout(timeoutId);

            if (!response.ok) { throw new Error(`Stream request failed (${response.status})`); }
            if (!response.body) { throw new Error(`Stream response empty`); }

             console.log(`[IPC chat:send-user-message] Stream fetch succeeded for ${messageId}. Reading chunks...`);
             const reader = response.body.getReader();
             const decoder = new TextDecoder();
             let assistantMessageId: string | null = null;
             let accumulatedContent = '';
             let firstChunk = true; // Flag to create assistant message in DB

             try {
                 while (true) {
                     const { done, value } = await reader.read();
                     if (done) break;
                     const chunk = decoder.decode(value, { stream: true });
                     accumulatedContent += chunk;

                     // Create DB entry on *first* chunk
                     if (firstChunk) {
                         firstChunk = false;
                         assistantMessageId = uuidv4();
                          chatService.upsertChatMessage({ // Use upsert
                             id: assistantMessageId,
                             threadId: messageData.threadId,
                             role: 'assistant',
                             content: chunk, // Start with first chunk
                             userId: userId,
                             syncStatus: 'sending_stream', // Mark as streaming initially
                             relatedUserMessageId: messageId,
                             timestamp: new Date().toISOString()
                         });
                         console.log(`[IPC chat:send-user-message] Created temp assistant message ${assistantMessageId} in DB.`);
                     }

                     // Send chunk to renderer
                     mainWindow.send('chat:chunk', {
                         threadId: messageData.threadId,
                         relatedUserMessageId: messageId,
                         assistantMessageId: assistantMessageId, // Pass ID being built
                         chunk: chunk
                     });
                 }

                 // Stream finished successfully - finalize DB records
                 if (assistantMessageId) {
                     chatService.finalizeAssistantMessageContent(assistantMessageId, accumulatedContent);
                     console.log(`[IPC chat:send-user-message] Finalized assistant message ${assistantMessageId}.`);
                 } else {
                     // Handle case where stream ended but no content/chunks were received? Maybe error?
                     console.warn(`[IPC chat:send-user-message] Stream ended for ${messageId} but no assistant message ID was created.`);
                 }
                 chatService.markUserMessageSynced(messageId); // Mark user message synced

                 mainWindow.send('chat:end', { relatedUserMessageId: messageId, assistantMessageId });

             } catch (streamReadError: unknown) { 
                 // Type guard to check if error is an Error object
                 const errorMessage = streamReadError instanceof Error 
                     ? streamReadError.message 
                     : typeof streamReadError === 'string'
                         ? streamReadError
                         : 'An unknown error occurred during stream reading';

                 console.error(`[IPC chat:send-user-message] Error reading stream for ${messageId}:`, errorMessage);
                 chatService.updateChatMessageStatus(messageId, 'error', errorMessage);
                 mainWindow.send('chat:error', { 
                     relatedUserMessageId: messageId, 
                     error: errorMessage 
                 });
             }
             finally { /* ... reader.cancel ... */ }

            return { success: true, messageId, timestamp: savedMessageTimestamp };

        } catch (error: any) { 
            console.error(`[IPC chat:send-user-message] General error for ${messageId}:`, error);
            chatService.updateChatMessageStatus(messageId, 'error', error.message);
            mainWindow.send('chat:error', { relatedUserMessageId: messageId, error: error.message });
            return { success: false, messageId, timestamp: savedMessageTimestamp };
        }
    });

    ipcMain.handle('chat:get-messages', async (event, threadId: string) => {
         try {
            const effectiveThreadId = threadId || 'default_thread';
            return chatService.getChatMessages(effectiveThreadId);
         } catch (error: any) {
             console.error(`[IPC chat:get-messages] Error:`, error);
             return []; // Return empty on error
         }
    });
}