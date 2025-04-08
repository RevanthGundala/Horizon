// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      // whitelist channels
      const validChannels = [
        'fetch-api', 
        'toMain',
        // Database operations
        'db:get-pages',
        'db:get-page',
        'db:create-page',
        'db:update-page',
        'db:delete-page',
        'db:get-blocks',
        'db:get-block',
        'db:create-block',
        'db:update-block',
        'db:delete-block',
        'db:update-blocks-batch',
        'db:get-pending-changes-count',
        // Sync operations
        'sync:request-sync',
        'sync:get-network-status',
        'sync:set-online-status'
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error(`Channel ${channel} is not allowed`));
    },
    send: (channel: string, data: any) => {
      // whitelist channels
      const validChannels = ['toMain'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel: string, func: (...args: any[]) => void) => {
      const validChannels = ['fromMain'];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender` 
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
});
