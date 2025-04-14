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
import dotenv from 'dotenv';

// --- Environment Variable Loading ---
const projectRoot = path.resolve(__dirname, '../../..'); // Adjust if needed
const envPath = path.resolve(projectRoot, 'electron', '.env.development');
dotenv.config({ path: envPath });
console.log(`[Main] Loading environment variables from: ${envPath}`);
console.log(`[Main] VITE_API_URL is: ${process.env.VITE_API_URL}`); // Verify it loaded

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

// --- Service Instances (initialized in whenReady) ---
let db: DatabaseService;
let syncService: SyncService;
let authService: AuthService; // Keep reference to the singleton

// --- Main Window Reference ---
// Store globally for easier access, though dependency injection is cleaner for larger apps
let mainWindow: BrowserWindow | null = null;

// --- Logging Setup ---
const setupLogging = () => {
    // ... (your existing logging setup code remains unchanged) ...
    const logPath = path.join(app.getPath('userData'), 'logs', `electron-${new Date().toISOString().replace(/:/g, '-')}.log`);
    // ... (rest of setupLogging) ...
    console.log(`📝 Electron logs will be saved to: ${logPath}`); // Ensure this runs
    return logPath;
};
const logPath = setupLogging(); // Set up logging early

// --- Create Window Function ---
const createWindow = () => {
    console.log('[Main] Creating main window...');
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
        console.log(`[Main] Loading file: ${indexPath}`);
        mainWindow.loadFile(indexPath);
    } else {
        const devUrl = 'http://localhost:5173'; // Ensure port matches Vite config
        console.log(`[Main] Loading URL: ${devUrl}`);
        mainWindow.loadURL(devUrl);
        mainWindow.webContents.openDevTools();
    }

    // Handle window close event
    mainWindow.on('close', () => {
        console.log('[Main] Main window closing...');
        if (syncService) {
            syncService.triggerSync();
        }
    });

    // Clear reference when closed
    mainWindow.on('closed', () => {
        console.log('[Main] Main window closed.');
        mainWindow = null;
        authService.setMainWindow(null); // Clear reference in AuthService too
    });

    console.log('[Main] Main window created.');
};

// --- Get WebContents Function (used by SyncService?) ---
// Make sure this correctly finds the window if needed elsewhere
export function getMainWindowWebContents(): WebContents | null {
    return mainWindow ? mainWindow.webContents : null;
    // Alternative: Find the first available window if mainWindow ref isn't reliable
    // const allWindows = BrowserWindow.getAllWindows();
    // return allWindows.length > 0 ? allWindows[0].webContents : null;
}


// =============================================================================
// App Lifecycle Events
// =============================================================================

app.whenReady().then(() => {
    console.log('[Main] App ready.');

    // --- Initialize Services ---
    console.log('[Main] Initializing Database Service...');
    db = DatabaseService.getInstance();

    console.log('[Main] Initializing Auth Service...');
    // AuthService constructor might trigger initial checkAuthStatus internally now or later
    authService = AuthService.getInstance(); // Access the singleton instance

    console.log('[Main] Initializing Sync Service...');
    syncService = SyncService.getInstance();
    // Consider if initialize needs auth status - might need adjustments
    syncService.initialize();

    // --- Setup Protocol Handler ---
    // This registers 'horizon://' and sets up handlers for open-url/second-instance/argv
    // These handlers will now call authService.checkAuthStatus() when triggered
    console.log('[Main] Setting up protocol handler...');
    setupProtocolHandler();

    // --- Setup IPC Handlers ---
    console.log('[Main] Setting up Database IPC Handlers...');
    setupDatabaseIpcHandlers();
    console.log('[Main] Setting up Auth IPC Handlers...');
    setupAuthIpcHandlers(); // Uses the updated handlers
    console.log('[Main] Setting up Chat IPC Handlers...');
    setupChatIpcHandlers();

    // --- Create Initial Window ---
    createWindow();

    // --- macOS activate handler ---
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            console.log('[Main] App activated (macOS), creating window.');
            createWindow();
        } else {
             console.log('[Main] App activated (macOS), window exists.');
             // Optionally focus existing window
             if(mainWindow) mainWindow.focus();
        }
    });
});

// --- Window All Closed Handler ---
app.on('window-all-closed', () => {
    console.log('[Main] All windows closed.');
    if (process.platform !== 'darwin') {
        console.log('[Main] Quitting app (non-macOS).');
        app.quit();
    }
});

// --- App Will Quit Handler (Cleanup) ---
app.on('will-quit', () => {
    console.log('[Main] App will quit. Cleaning up...');
    if (syncService) {
        syncService.shutdown();
    }
    if (db) {
        db.close();
    }
    // Close log stream if setupLogging returns it and stores it
    // logStream.end();
    console.log('[Main] Cleanup finished.');
});


// --- Removed Obsolete Logic ---
// Removed: app.on('will-finish-launching', ...) - Handled by setupProtocolHandler now.
// Removed: ipcMain.on('protocol-detected', ...) - No longer needed, protocol handled by setupProtocolHandler triggering checkAuthStatus.