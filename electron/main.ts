import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import DatabaseService from './database';
import SyncService from './database/sync';
import { setupDatabaseIpcHandlers } from './database/ipc-handlers';
import AuthService from './auth';
import { setupAuthIpcHandlers } from './auth/ipc-handlers';
import { setupProtocolHandler } from './auth/protocol-handler';

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
let authService: AuthService;

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

// Set up logging to file
const setupLogging = () => {
  const userDataPath = app.getPath('userData');
  const logDir = path.join(userDataPath, 'logs');
  
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logPath = path.join(logDir, `electron-${new Date().toISOString().replace(/:/g, '-')}.log`);
  console.log(`📝 Electron logs will be saved to: ${logPath}`);
  
  // Create a write stream
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  
  // Store the original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Override console methods to write to file
  console.log = function(...args) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    
    logStream.write(`[LOG] ${new Date().toISOString()} - ${message}\n`);
    originalConsoleLog.apply(console, args);
  };
  
  console.error = function(...args) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    
    logStream.write(`[ERROR] ${new Date().toISOString()} - ${message}\n`);
    originalConsoleError.apply(console, args);
  };
  
  console.warn = function(...args) {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    
    logStream.write(`[WARN] ${new Date().toISOString()} - ${message}\n`);
    originalConsoleWarn.apply(console, args);
  };
  
  // Clean up on app quit
  app.on('will-quit', () => {
    logStream.end();
  });
  
  return logPath;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Initialize database
  db = DatabaseService.getInstance();
  
  // Initialize auth service
  authService = AuthService.getInstance();
  
  // Set up protocol handler for OAuth
  setupProtocolHandler();
  
  // Set up logging
  const logPath = setupLogging();
  console.log('Electron app starting...');

  // Set up IPC handlers for database operations
  setupDatabaseIpcHandlers();
  
  // Set up IPC handlers for authentication operations
  setupAuthIpcHandlers();
  
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
