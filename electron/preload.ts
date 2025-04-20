// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

// Define consistent whitelists
// Channels for invoke (Renderer -> Main -> Renderer)
const validInvokeChannels = [
    'toMain', // Example if needed
    // Database
    'db:get-notes', 'db:get-note', 'db:create-note', 'db:update-note', 'db:delete-note',
    'db:get-blocks', 'db:get-block', 'db:create-block', 'db:update-block', 'db:delete-block',
    'db:update-blocks-batch', 'db:get-pending-changes-count', 'db:get-pending-sync-count',
    'db:sync', 'db:get-user-id', 'db:get-workspaces', 'db:create-workspace',
    'db:update-workspace', 'db:delete-workspace', 'db:user-exists',
    // Sync
    'sync:request-sync', 'sync:get-network-status', 'sync:user', 'sync:set-online-status',
    // Auth
    'auth:login', 'auth:logout', 'auth:check-status', 'auth:get-status', 'auth:get-user-id',
    'sync:get-auth-cookie', // Seems auth related
    // Chat (Request/Response style)
    'chat:send-user-message', // Triggers the stream flow
    'chat:get-messages'      // Gets history
];

// Channels for send (Renderer -> Main, fire-and-forget) - Keep minimal
const validSendChannels = ['toMain']; // Example

// Channels for on/receive (Main -> Renderer)
const validReceiveChannels = [
    'fromMain', // Example
    'auth:status-changed',
    // 'auth-success', // Is this needed? Usually handled by protocol handler
    // Chat Streaming Events *** Use correct names ***
    'chat:new-assistant-message', // First chunk event
    'chat:stream-chunk',          // Subsequent chunk event
    'chat:stream-end',            // Stream end event
    'chat:stream-error',          // Stream error event
    // Other async updates from main
    'sync:set-online-status' // Example
];


contextBridge.exposeInMainWorld('electron', {
    isElectron: true,
    ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => {
            if (validInvokeChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, ...args);
            }
            console.error(`[Preload Invoke] Blocked channel: ${channel}`);
            return Promise.reject(new Error(`Channel ${channel} is not allowed for invoke`));
        },
        send: (channel: string, data: any) => {
            if (validSendChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            } else {
                console.error(`[Preload Send] Blocked channel: ${channel}`);
            }
        },
         // Expose 'on' primarily, returning a cleanup function is the modern pattern
         on: (channel: string, listener: (...args: any[]) => void) => {
          if (validReceiveChannels.includes(channel)) {
              const safeListener = (event: Electron.IpcRendererEvent, ...args: any[]) => {
                  // *** ADD THIS LINE: ***
                  console.log(`%c[Preload] Event received on channel '${channel}'. Calling renderer listener...`, 'color: green; font-weight: bold;', args);
                  // The original line that calls your useChat hook's handler:
                  listener(...args);
              };
              ipcRenderer.on(channel, safeListener);
              return () => {
                  ipcRenderer.removeListener(channel, safeListener);
              };
          } else {
              console.warn(`[Preload On] Blocked channel: ${channel}`);
              return () => {};
          }
      },
         // Exposing removeListener/off separately is often redundant if 'on' returns cleanup,
         // and can be tricky to get right with wrapped listeners.
         // Consider removing these unless absolutely needed.
        removeListener: (channel: string, listenerToRemove: (...args: any[]) => void) => {
             console.warn(`[Preload] removeListener/off is discouraged when 'on' returns a cleanup function. Use the returned cleanup function instead.`);
             // This is difficult to implement correctly without tracking the 'safeListener' wrapper.
             // It's generally better to rely on the cleanup function returned by 'on'.
            // if (validReceiveChannels.includes(channel)) {
            //    ipcRenderer.removeListener(channel, listenerToRemove); // Might not remove the wrapped listener
            // } else {
            //     console.error(`[Preload RemoveListener] Blocked channel: ${channel}`);
            // }
        }
        // Remove 'receive' and 'off' if 'on' pattern is used consistently
    }
});