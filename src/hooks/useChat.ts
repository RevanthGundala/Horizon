// hooks/useChat.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { chatService } from '../services/ChatService'; // Adjust path

// Define the shape of the message object used in the UI state
export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date; // Use Date objects in UI state for easier formatting
  threadId: string;
  syncStatus?: string; // Optional: for displaying status indicators
  error?: string;     // Optional: for displaying errors per message
}

export const useChat = (initialThreadId: string = 'default_thread') => {
    const [currentThreadId, setCurrentThreadId] = useState<string>(initialThreadId);
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false); // Is the assistant "thinking"/streaming?
    const [error, setError] = useState<string | null>(null); // General chat error
    const streamingAssistantMessageId = useRef<string | null>(null); // Track ID of message being streamed

    // --- Load initial messages ---
    const loadMessages = useCallback(async () => {
        console.log(`useChat: Loading messages for thread ${currentThreadId}`);
        setIsLoading(true); // Indicate loading history
        setError(null);
        try {
            const loadedMessages = await chatService.getMessages(currentThreadId);
            // Map DB records to UI state, converting timestamp string to Date
            setMessages(loadedMessages.map(m => ({
                ...m,
                timestamp: new Date(m.timestamp) // Convert to Date object
            })));
            console.log(`useChat: Loaded ${loadedMessages?.length || 0} messages.`);
        } catch (err: any) {
            console.error("useChat: Failed to load chat messages:", err);
            setError(`Failed to load chat history: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    }, [currentThreadId]);

    // Load messages when threadId changes
    useEffect(() => {
        loadMessages();
    }, [loadMessages]); // Dependency is loadMessages which depends on currentThreadId

    // --- Listen for IPC events from Main process ---
    useEffect(() => {
        if (!window.electron) {
            console.warn("useChat: Not in Electron, skipping IPC listeners.");
            return;
        };

        console.log('useChat: Setting up IPC listeners for thread:', currentThreadId);

        const handleChunk = (chunkData: { threadId: string; relatedUserMessageId: string; assistantMessageId: string | null; chunk: string }) => {
            // console.log('useChat: Received chunk:', chunkData);
            if (chunkData.threadId !== currentThreadId) return;

            setError(null);
            setIsLoading(true); // Ensure loading is true while chunks arrive

            setMessages(prevMessages => {
                if (!chunkData.assistantMessageId) {
                     console.warn("useChat chunk: Received chunk without assistantMessageId");
                     return prevMessages; // Safety check
                }

                const existingMsgIndex = prevMessages.findIndex(msg => msg.id === chunkData.assistantMessageId);

                if (existingMsgIndex !== -1) {
                    // Append chunk to existing message
                    const updatedMessages = [...prevMessages];
                    updatedMessages[existingMsgIndex] = {
                        ...updatedMessages[existingMsgIndex],
                        content: updatedMessages[existingMsgIndex].content + chunkData.chunk
                    };
                    return updatedMessages;
                } else {
                    // First chunk: Add new assistant message
                    console.log("useChat chunk: Adding new assistant message", chunkData.assistantMessageId);
                    streamingAssistantMessageId.current = chunkData.assistantMessageId;
                    return [
                        ...prevMessages,
                        {
                            id: chunkData.assistantMessageId,
                            role: 'assistant',
                            content: chunkData.chunk,
                            timestamp: new Date(), // Timestamp of first chunk arrival
                            threadId: chunkData.threadId,
                            syncStatus: 'sending_stream' // Indicate it's streaming
                        }
                    ];
                }
            });
        };

        const handleEnd = (endData: { relatedUserMessageId: string; assistantMessageId: string | null }) => {
             console.log('useChat: Received stream end for assistant ID:', endData.assistantMessageId);
             // Check if this is the stream we were tracking
             if (streamingAssistantMessageId.current === endData.assistantMessageId) {
                setIsLoading(false); // Stop loading indicator
                streamingAssistantMessageId.current = null; // Clear tracker
                // Optional: Mark the specific message as 'synced' in the UI state
                 setMessages(prev => prev.map(msg => msg.id === endData.assistantMessageId ? { ...msg, syncStatus: 'synced' } : msg));
             }
        };

        const handleError = (errorData: { relatedUserMessageId: string; error: string }) => {
            console.error('useChat: Received stream/processing error:', errorData);
            setError(`Assistant error: ${errorData.error}`);
            setIsLoading(false); // Stop loading on error
            streamingAssistantMessageId.current = null; // Clear tracker
            // Optional: Mark the user message associated with the error?
        };

        const handleNewAssistantMessage = (newMessageRecord: ChatMessageRecord) => {
              console.log('useChat: Received new assistant message from background sync:', newMessageRecord);
              if (newMessageRecord.threadId !== currentThreadId) return;

              const newMessage: UIMessage = {
                  ...newMessageRecord,
                  timestamp: new Date(newMessageRecord.timestamp) // Convert timestamp
              };

              setMessages(prev => {
                  const exists = prev.some(msg => msg.id === newMessage.id);
                  if (!exists) {
                     console.log(`useChat newMsg: Adding message ${newMessage.id}`);
                     // Add message and re-sort
                     const updated = [...prev, newMessage];
                     updated.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
                     return updated;
                  } else {
                     console.log(`useChat newMsg: Updating existing message ${newMessage.id}`);
                     // Update existing message content/status if needed
                     return prev.map(msg => msg.id === newMessage.id ? newMessage : msg);
                  }
              });
              // Stop loading if we get a background message while waiting
              setIsLoading(false);
              streamingAssistantMessageId.current = null; // Ensure tracker is clear
         };

        // --- Register listeners ---
        const cleanupFns: Array<() => void> = [
            () => window.electron.ipcRenderer.removeListener('chat:chunk', handleChunk),
            () => window.electron.ipcRenderer.removeListener('chat:end', handleEnd),
            () => window.electron.ipcRenderer.removeListener('chat:error', handleError),
            () => window.electron.ipcRenderer.removeListener('chat:new-assistant-message', handleNewAssistantMessage),
        ];

        // Register the actual listeners
        window.electron.ipcRenderer.on('chat:chunk', handleChunk);
        window.electron.ipcRenderer.on('chat:end', handleEnd);
        window.electron.ipcRenderer.on('chat:error', handleError);
        window.electron.ipcRenderer.on('chat:new-assistant-message', handleNewAssistantMessage);

        // --- Cleanup function ---
        return () => {
            console.log('useChat: Cleaning up IPC listeners for thread:', currentThreadId);
            cleanupFns.forEach(cleanup => cleanup());
        };
    }, [currentThreadId]); // Re-subscribe if threadId changes


    // --- Function to send a message ---
    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim() || isLoading) return; // Prevent sending empty or while loading

        const tempId = `local-${Date.now()}`;
        const userMessage: UIMessage = {
            id: tempId,
            role: 'user',
            content: content.trim(),
            timestamp: new Date(),
            threadId: currentThreadId,
            syncStatus: 'local'
        };

        // Optimistic UI update
        setMessages(prev => [...prev, userMessage]);
        setError(null);
        setIsLoading(true); // Start loading indicator
        streamingAssistantMessageId.current = null; // Reset tracker

        try {
            // Call the service method to save locally and trigger backend
            const result = await chatService.sendMessage({
                threadId: currentThreadId,
                content: content.trim()
            });

            if (result?.success && result.messageId) {
                 console.log(`useChat sendMessage: User message ${result.messageId} sent to main process.`);
                 // Update message ID from temp to real one
                 setMessages(prev => prev.map(msg =>
                    msg.id === tempId ? { ...msg, id: result.messageId!, timestamp: new Date(result.timestamp!) } : msg
                 ));
                 // Keep isLoading=true, waiting for 'chat:chunk', 'chat:end', or 'chat:error'
            } else {
                throw new Error(result?.error || 'Failed to initiate message send');
            }
        } catch (err: any) {
            console.error('useChat sendMessage: Error:', err);
            setError(err.message);
            setIsLoading(false); // Stop loading on immediate failure
            // Mark optimistic message as failed
            setMessages(prev => prev.map(msg =>
                msg.id === tempId ? { ...msg, syncStatus: 'error', error: err.message } : msg
            ));
        }
    }, [currentThreadId, isLoading]); // Include isLoading in dependencies

    return {
        currentThreadId,
        setCurrentThreadId, // Allow changing threads
        messages,
        isLoading,
        error,
        sendMessage, // Function to send a new message
        loadMessages, // Function to manually reload messages if needed
    };
};

// Helper type (ensure it matches DB record)
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