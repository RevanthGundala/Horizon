import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import https from 'https';
import DatabaseService from './database';
import SyncService from './database/sync';
import { setupDatabaseIpcHandlers } from './database/ipc-handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
let squirrelStartup = false;
try {
  squirrelStartup = require('electron-squirrel-startup');
} catch (e) {
  console.log('electron-squirrel-startup not available');
}

if (squirrelStartup) {
  app.quit();
}

// Initialize database and sync services
let db: DatabaseService;
let syncService: SyncService;

// Handle API fetch requests from the renderer process
ipcMain.handle('fetch-api', async (event, url) => {
  console.log('Fetching API from main process:', url);
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      // A chunk of data has been received
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      // The whole response has been received
      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: parsedData
          });
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : 'Unknown error parsing JSON';
          reject(new Error(`Error parsing JSON: ${errorMessage}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Error making request: ${err.message}`));
    });
  });
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In production, set the initial browser path to the local bundled Vite output
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  } else {
    // In development, use the Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open the DevTools.
    mainWindow.webContents.openDevTools();
  }

  // Handle window close event
  mainWindow.on('close', () => {
    // Perform any cleanup needed before the window closes
    if (syncService) {
      // Try to sync one last time before closing
      syncService.syncWithServer().catch(err => {
        console.error('Error during final sync:', err);
      });
    }
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Initialize database
  db = DatabaseService.getInstance();
  
  // Set up IPC handlers for database operations
  setupDatabaseIpcHandlers();
  
  // Initialize sync service
  syncService = SyncService.getInstance();
  syncService.initialize();
  
  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up resources before quitting
app.on('will-quit', () => {
  if (syncService) {
    syncService.shutdown();
  }
  
  if (db) {
    db.close();
  }
});
