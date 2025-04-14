// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      // whitelist channels
      const validChannels = [
        'toMain',
        // Database operations
        'db:get-notes',
        'db:get-note',
        'db:create-note',
        'db:update-note',
        'db:delete-note',
        'db:get-blocks',
        'db:get-block',
        'db:create-block',
        'db:update-block',
        'db:delete-block',
        'db:update-blocks-batch',
        'db:get-pending-changes-count',
        'db:get-pending-sync-count', 
        'db:sync', 
        'db:get-user-id',
        'db:get-workspaces',
        'db:create-workspace',
        'db:update-workspace',
        'db:delete-workspace',
        // Sync operations
        'sync:request-sync',
        'sync:get-network-status',
        'sync:set-online-status',
        'auth:login',
        'auth:logout',
        'auth:check-status',
        'auth:get-status',
        'sync:get-auth-cookie',
        'db:user-exists',
        'sync:user',
        'sync:set-online-status',
        'auth-success',
       // *** ADD CHAT CHANNELS ***
       'chat:chunk',
       'chat:end',
       'chat:error',
       'chat:new-assistant-message',
       'chat:send-user-message',
       'chat:get-messages'
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      console.error(`[Preload Invoke] Blocked channel: ${channel}`);
      return Promise.reject(new Error(`Channel ${channel} is not allowed for invoke`));
    },
    send: (channel: string, data: any) => {
      // whitelist channels
      const validChannels = ['toMain'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      } else {
        console.error(`[Preload Send] Blocked channel: ${channel}`);
      }
    },
    receive: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = ['fromMain', 'auth:get-status', 'auth:status-changed', 'auth-success', 'chat:chunk', 'chat:end', 'chat:error', 'chat:new-assistant-message', 'chat:send-user-message', 'chat:get-messages', 'sync:set-online-status'];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender` 
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    on: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = ['fromMain', 'auth:get-status', 'auth:status-changed', 'auth-success', 'chat:chunk', 'chat:end', 'chat:error', 'chat:new-assistant-message', 'chat:send-user-message', 'chat:get-messages', 'sync:set-online-status']; // ADD 'auth-success'
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender` (avoid exposing too much)
        const saferListener = (event: any, ...args: any[]) => func(...args);
        ipcRenderer.on(channel, saferListener);
        // Return a cleanup function that removes the *specific* listener
        return () => {
          ipcRenderer.removeListener(channel, saferListener);
        };
      } else {
        console.error(`[Preload On] Blocked channel: ${channel}`);
        // Return a no-op cleanup function for disallowed channels
        return () => {ipcRenderer.removeListener(channel, func);};
      }
    },
    off: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = ['fromMain', 'auth:status-changed', 'auth-success', 'chat:chunk', 'chat:end', 'chat:error', 'chat:new-assistant-message', 'chat:send-user-message', 'chat:get-messages', 'sync:set-online-status']; // ADD 'auth-success'
      if (validChannels.includes(channel)) {
        // Same as removeListener but with a different name
        ipcRenderer.removeListener(channel, (event: any, ...args: any[]) => func(...args));
      } else {
        console.error(`[Preload Off] Blocked channel: ${channel}`);
      }
    },
    removeListener: (channel: string, listener: (...args: any[]) => void) => {
      const validChannels = ['fromMain', 'auth:status-changed', 'auth-success', 'chat:chunk', 'chat:end', 'chat:error', 'chat:new-assistant-message', 'chat:send-user-message', 'chat:get-messages', 'sync:set-online-status']; // ADD 'auth-success'
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, listener);
      } else {
        console.error(`[Preload RemoveListener] Blocked channel: ${channel}`);
      }
    }
  }
});
