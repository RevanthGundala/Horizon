// Create new file: chat/ipc-handlers.ts

import { ipcMain, session, net } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '../auth'; // Adjust path
import { ChatService } from './index'; // Adjust path
import { getMainWindowWebContents } from '../main';

const authService = AuthService.getInstance();
const chatService = ChatService.getInstance();

export function setupChatIpcHandlers(): void {

    ipcMain.handle('chat:send-user-message', async (event, messageData: { threadId: string; content: string }) => {
        // --- Initial Setup ---
        console.log('[IPC chat:send-user-message] Received:', messageData);
        const mainWindow = getMainWindowWebContents(); // Get webContents AT THE START
        const userId = authService.getUserId();
    
        // Initial checks
        if (!userId) {
            console.error('[IPC chat:send-user-message] Error: User not authenticated.');
            return { success: false, error: 'User not authenticated' };
        }
        if (!mainWindow || mainWindow.isDestroyed()) { // Check validity early
             console.error('[IPC chat:send-user-message] Error: Main window not available or destroyed.');
             return { success: false, error: 'Main window not available' };
        }
        const apiUrl = process.env.API_URL; // Moved URL check higher
         if (!apiUrl) {
             console.error("API_URL is not configured.");
             // No need to update DB status here, just return error
             return { success: false, error: "API URL not configured" };
         }
         const chatUrl = `${apiUrl}/api/chat`; // Define chatUrl here
    
        // Save user message
        const savedMessage = chatService.upsertChatMessage({
            id: uuidv4(),
            threadId: messageData.threadId,
            role: 'user',
            content: messageData.content,
            userId: userId,
            timestamp: new Date().toISOString(),
            syncStatus: 'sending_stream'
        });
        const messageId = savedMessage.id;
        const savedMessageTimestamp = savedMessage.timestamp;
    
        let assistantMessageId: string | null = null; // Define here for broader scope in case of errors
        let timeoutId: ReturnType<typeof setTimeout> | undefined; // Declare optional timeoutId for cleanup
    
        try {
            // --- Authentication Check ---
            // Optional: Check local state first as a quick fail, but Lambda will re-check
            if (!authService.isAuthenticated()) {
                 console.error("Not authenticated according to AuthService state. Aborting chat request.");
                 chatService.updateChatMessageStatus(messageId, 'error', 'Not Authenticated'); // Keep DB update here
                 // No need to throw, just return failure
                 return { success: false, error: "Not authenticated" };
            }
    
            // --- Prepare Fetch ---
            const messageHistory = chatService.getMessageHistoryForContext(messageData.threadId);
            const historyWithoutCurrent = messageHistory.filter(m => !(m.role === 'user' && m.content === messageData.content));
            historyWithoutCurrent.push({ role: 'user', content: messageData.content });
    
            const abortController = new AbortController();
            timeoutId = setTimeout(() => abortController.abort('timeout'), 30000); // Add reason
    
            console.log(`[IPC chat:send-user-message] Attempting fetch to ${chatUrl}`);
    
            // --- Fetch Call ---
            const response = await net.fetch(chatUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: historyWithoutCurrent }),
                signal: abortController.signal,
                credentials: 'include',
            });
            if (timeoutId) { clearTimeout(timeoutId); } // Only clear if assigned
    
            console.log(`[IPC chat:send-user-message] Fetch status: ${response.status}`);
    
            if (!response.ok) {
                let errorBody = `HTTP ${response.status}`;
                try { errorBody = await response.text(); } catch { /* ignore */ }
                throw new Error(`Workspace failed: ${response.status} - ${errorBody}`); // Throw specific error
            }
            if (!response.body) {
                throw new Error("Fetch response received without a body.");
            }
    
            // --- Stream Reading ---
            console.log(`[IPC chat:send-user-message] Fetch succeeded for ${messageId}. Reading stream...`);
            let accumulatedContent = '';
            let firstChunk = true;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let streamErrorOccurred = false; // Flag to manage flow after stream error
    
            while (true) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log('[IPC chat:send-user-message] Fetch stream ended normally.');
                        break; // Exit loop
                    }
    
                    const chunkStr = decoder.decode(value, { stream: true });
                    console.log('[IPC chat:send-user-message] Received chunk:', chunkStr); // Keep for debugging
                    accumulatedContent += chunkStr;
    
                    // Ensure window still valid before sending IPC messages
                    if (!mainWindow || mainWindow.isDestroyed()) {
                        console.error("[IPC] Window destroyed during stream processing. Aborting IPC sends.");
                        streamErrorOccurred = true; // Treat as an error state
                        break; // Exit loop
                    }
    
                    if (firstChunk) {
                        firstChunk = false;
                        assistantMessageId = uuidv4();
                        // Save initial chunk to DB
                        chatService.upsertChatMessage({
                            id: assistantMessageId,
                            threadId: messageData.threadId,
                            role: 'assistant',
                            content: chunkStr,
                            userId: userId,
                            timestamp: new Date().toISOString(),
                            syncStatus: 'sending_stream'
                        });
    
                        // Send 'NEW MESSAGE + FIRST CHUNK' TO RENDERER
                        const payload = { assistantMessageId, firstChunk: chunkStr, relatedUserMessageId: messageId, threadId: messageData.threadId };
                        console.log('[IPC Check & Send] Sending chat:new-assistant-message. Payload:', payload); // Check + Payload Log
                        mainWindow.send('chat:new-assistant-message', payload);
    
                    } else {
                        if (assistantMessageId) {
                            // Update DB entry
                            chatService.upsertChatMessage({
                                id: assistantMessageId,
                                threadId: messageData.threadId,
                                role: 'assistant',
                                content: chunkStr,
                                userId: userId,
                                timestamp: new Date().toISOString(),
                                syncStatus: 'sending_stream'
                            });
    
                            // Send 'SUBSEQUENT CHUNK' TO RENDERER
                            // *** FIX: Include threadId ***
                            const payload = { assistantMessageId, chunk: chunkStr, threadId: messageData.threadId };
                            console.log('[IPC Check & Send] Sending chat:stream-chunk. Payload:', payload); // Check + Payload Log
                            mainWindow.send('chat:stream-chunk', payload);
                        }
                    }
                } catch (streamReadError) {
                    console.error("[IPC chat:send-user-message] Error reading fetch stream chunk:", streamReadError);
                    streamErrorOccurred = true; // Set flag
                     // Send error to renderer ONCE
                     if (mainWindow && !mainWindow.isDestroyed()) {
                         const errorMsg = streamReadError instanceof Error ? streamReadError.message : 'Stream read error';
                         const payload = { relatedUserMessageId: messageId, assistantMessageId, error: errorMsg, threadId: messageData.threadId };
                         console.log('[IPC Check & Send] Sending chat:stream-error. Payload:', payload);
                         mainWindow.send('chat:stream-error', payload);
                     }
                     // Don't rethrow here, just break the loop
                     break;
                }
            } // End while loop
    
            // --- Finalization ---
            reader.releaseLock(); // Release reader lock
    
             // Finalize DB records IF no error occurred during streaming
             if (!streamErrorOccurred && assistantMessageId) {
                chatService.finalizeAssistantMessageContent(assistantMessageId, accumulatedContent);
                console.log(`[IPC chat:send-user-message] Finalized assistant message ${assistantMessageId}.`);
                // Send END event
                 if (mainWindow && !mainWindow.isDestroyed()) {
                     const payload = { assistantMessageId, threadId: messageData.threadId }; // Add threadId for consistency?
                     console.log('[IPC Check & Send] Sending chat:stream-end. Payload:', payload);
                     mainWindow.send('chat:stream-end', payload);
                 }
            } else if (!streamErrorOccurred && !assistantMessageId) {
                // Stream ended normally but no chunks received
                console.warn(`[IPC chat:send-user-message] Stream ended for ${messageId} but no data/assistant message was processed.`);
                 if (mainWindow && !mainWindow.isDestroyed()) {
                     const payload = { assistantMessageId: null, threadId: messageData.threadId };
                     console.log('[IPC Check & Send] Sending chat:stream-end (no data). Payload:', payload);
                     mainWindow.send('chat:stream-end', payload);
                 }
            }
            // If streamErrorOccurred, the stream-error event was already sent. Don't send stream-end.
    
            // Mark user message synced (do this even if assistant message had errors?)
            chatService.markUserMessageSynced(messageId);
            return { success: true, messageId, timestamp: savedMessageTimestamp }; // Return success if fetch succeeded initially
    
        } catch (error) { // Catch errors from setup, fetch call, or rethrown stream errors (if not handled above)
             if (timeoutId) { clearTimeout(timeoutId); } // Only clear if assigned
             const errorMessage = error instanceof Error ? error.message : 'Unknown error during chat processing';
             console.error(`[IPC chat:send-user-message] Overall error for ${messageId}:`, errorMessage, error); // Log full error
    
             // Ensure renderer knows about the error if it happened before stream started
             if (mainWindow && !mainWindow.isDestroyed()) {
                  // Check if stream-error was already sent inside the loop
                  // This logic might need refinement depending on desired error reporting
                  // Maybe send a generic 'chat:fatal-error' ?
                  // For now, let's rely on the stream-error event or the return value
             }
    
             // Update DB status
             chatService.updateChatMessageStatus(messageId, 'error', errorMessage);
             return { success: false, messageId, timestamp: savedMessageTimestamp, error: errorMessage }; // Return failure
        }
    }); // End ipcMain.handle 


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