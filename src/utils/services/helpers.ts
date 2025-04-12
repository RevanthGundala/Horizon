export const isElectron = () => {
  return window.electron !== undefined;
};
  
export const ipcCall = <T = any>(channel: string, ...args: any[]): Promise<T> => {
    if (!isElectron()) {
      return Promise.reject(new Error('Electron IPC not available'));
    }
    return window.electron.ipcRenderer.invoke(channel, ...args);
  };
  