import { app, BrowserWindow, ipcMain, shell, WebContents } from 'electron';
import path from 'path';
import fs from 'fs';
import DatabaseService from './data';
import { SyncService } from './sync';
import { setupDatabaseIpcHandlers } from './data/ipc-handlers';
// Import the AuthService singleton instance directly if that's how you export it
import { AuthService } from './auth'; // Assuming AuthService file exports the singleton instance
import { setupAuthIpcHandlers } from './auth/ipc-handlers';
import { setupProtocolHandler } from './auth/protocol-handler';
import { setupChatIpcHandlers } from './chat/ipc-handlers';
import { setupSyncIpcHandlers } from './sync/ipc-handlers';
import dotenv from 'dotenv';

// --- Environment Variable Loading ---
const projectRoot = path.resolve(__dirname, '../../..'); // Adjust if needed
const envPath = path.resolve(projectRoot, 'electron', '.env.development');
dotenv.config({ path: envPath });

// --- Squirrel Startup Handling ---
let squirrelStartup = false;
try {
    squirrelStartup = require('electron-squirrel-startup');
} catch (e) {
    console.log('[Main] electron-squirrel-startup not available');
}
if (squirrelStartup) {
    app.quit();
}

// On macOS: set up protocol handler before ready so open-url events fire
if (process.platform === 'darwin') {
    app.on('will-finish-launching', () => {
        console.log('[Main] will-finish-launching, setting up protocol handler');
        setupProtocolHandler();
    });
}

// --- Service Instances (initialized in whenReady) ---
let db: DatabaseService;
let syncService: SyncService;
let authService: AuthService; // Keep reference to the singleton

// --- Main Window Reference ---
// Store globally for easier access, though dependency injection is cleaner for larger apps
let mainWindow: BrowserWindow | null = null;

// --- Logging Setup ---
const setupLogging = () => {
    const logPath = path.join(app.getPath('userData'), 'logs', `electron-${new Date().toISOString().replace(/:/g, '-')}.log`);
    return logPath;
};
const logPath = setupLogging(); // Set up logging early

// --- Create Window Function ---
const createWindow = () => {
    mainWindow = new BrowserWindow({ // Assign to global variable
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, './preload.js'), // Verify preload path
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // --- Pass window reference to AuthService ---
    // It needs this to send 'auth-status-changed' events
    authService.setMainWindow(mainWindow); // Use the method we added previously

    // Load the UI
    if (app.isPackaged) {
        const indexPath = path.join(__dirname, '../../index.html'); // Verify path for packaged app
        mainWindow.loadFile(indexPath);
    } else {
        const devUrl = 'http://localhost:5173'; // Ensure port matches Vite config
        mainWindow.loadURL(devUrl);
        mainWindow.webContents.openDevTools();
    }

    // Handle window close event
    mainWindow.on('close', () => {
        if (syncService) {
            syncService.triggerSync();
        }
    });

    // Clear reference when closed
    mainWindow.on('closed', () => {
        mainWindow = null;
        authService.setMainWindow(null); // Clear reference in AuthService too
    });
};

// --- Get WebContents Function (used by SyncService?) ---
// Make sure this correctly finds the window if needed elsewhere
export function getMainWindowWebContents(): WebContents | null {
    return mainWindow ? mainWindow.webContents : null;
    // Alternative: Find the first available window if mainWindow ref isn't reliable
    // const allWindows = BrowserWindow.getAllWindows();
    // return allWindows.length > 0 ? allWindows[0].webContents : null;
}

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

// =============================================================================
// App Lifecycle Events
// =============================================================================

app.whenReady().then(() => {
    // --- Initialize Services ---
    db = DatabaseService.getInstance();
    authService = AuthService.getInstance();

    syncService = SyncService.getInstance();
    // Consider if initialize needs auth status - might need adjustments
    syncService.initialize();

    // Protocol handler already set up on macOS before ready

    // --- Setup IPC Handlers ---
    setupDatabaseIpcHandlers();
    setupAuthIpcHandlers();
    setupChatIpcHandlers();
    setupSyncIpcHandlers(); // Register sync channels including 'sync:set-online-status'

    // --- Create Initial Window ---
    createWindow();

    // --- macOS activate handler ---
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
             // Optionally focus existing window
             if(mainWindow) mainWindow.focus();
        }
    });
});

// --- Window All Closed Handler ---
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- App Will Quit Handler (Cleanup) ---
app.on('will-quit', () => {
    if (syncService) {
        syncService.shutdown();
    }
    if (db) {
        db.close();
    }
});
