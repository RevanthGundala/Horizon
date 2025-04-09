// Type definitions for Electron IPC
interface ElectronAPI {
  ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    send(channel: string, data: any): void;
    receive(channel: string, func: (...args: any[]) => void): void;
    on(channel: string, callback: (...args: any[]) => void): void;
    removeListener(channel: string, callback: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
  }
}

interface Window {
  electron: ElectronAPI;
}
