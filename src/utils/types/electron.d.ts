interface Window {
  electron: {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, data: any): void;
      receive(channel: string, listener: (...args: any[]) => void): void;
      removeListener(channel: string, listener: (...args: any[]) => void): void;
      on(channel: string, listener: (...args: any[]) => void): void;
      off(channel: string, listener: (...args: any[]) => void): void;
    };
  };
}