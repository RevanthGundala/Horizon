// minimal_main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

// --- Protocol Definition ---
const APP_PROTOCOL = 'horizon'; // Use the same protocol name

let mainWindow;

function createWindow() {
    console.log('[Minimal] Creating main window...');
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false, // Best practice
            contextIsolation: true, // Best practice
        },
    });
    // Optional: Load a simple HTML file or URL
    // mainWindow.loadFile('index.html');
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    console.log('[Minimal] Main window created.');
}

function setupMinimalProtocolHandler() {
    console.log(`[Minimal] Setting up protocol handler for '${APP_PROTOCOL}'...`);

    // Ensure only one instance runs (good practice, might affect focus)
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        console.log('[Minimal] Another instance already running, quitting.');
        app.quit();
        return;
    } else {
        // Optional: Handle second instance focus (not strictly needed for open-url test)
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            console.log('[Minimal] Second instance event triggered.');
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        });
    }

    // --- Protocol Registration ---
    // Force removal first for a clean state during testing
    app.removeAsDefaultProtocolClient(APP_PROTOCOL);

    // Register specifically for development mode testing
    if (process.defaultApp) {
        console.log('[Minimal] Running in development mode (process.defaultApp is true).');
        // IMPORTANT: The arguments here depend on HOW you launch the app.
        // This assumes you run like `electron .` or `electron minimal_main.js`
        // If using electron-forge or similar, process.argv[1] might be different!
        if (process.argv.length >= 2) {
            console.log(`[Minimal] Registering with execPath: ${process.execPath}`);
            console.log(`[Minimal] Registering with args[1]: ${process.argv[1]}`);
            const registrationSuccess = app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
                // Use path.resolve to handle cases like `.` from `electron .`
                path.resolve(process.argv[1])
            ]);
            console.log(`[Minimal] app.setAsDefaultProtocolClient success: ${registrationSuccess}`);
        } else {
            console.error('[Minimal] Could not register protocol in dev mode, missing args.');
        }
    } else {
        console.warn('[Minimal] Not running in development mode (process.defaultApp is false). Registering without path args.');
        // For a packaged app, Electron usually handles paths automatically
        const registrationSuccess = app.setAsDefaultProtocolClient(APP_PROTOCOL);
         console.log(`[Minimal] app.setAsDefaultProtocolClient success (packaged mode assumption): ${registrationSuccess}`);
    }

     // Verify registration right after setting it
     // Note: This check might require a short delay or might not update instantly
     setTimeout(() => {
        const isRegistered = app.isDefaultProtocolClient(APP_PROTOCOL);
        console.log(`[Minimal] Is default protocol client for '${APP_PROTOCOL}' (check after timeout): ${isRegistered}`);
     }, 1000); // Check after 1 second


    // --- macOS 'open-url' Event Listener ---
    console.log(`[Minimal] Attaching 'open-url' listener...`);
    app.on('open-url', (event, url) => {
        // THIS IS THE LOG WE ARE LOOKING FOR
        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.log('!!!! [Minimal] macOS open-url event FIRED !!!!');
        console.log('!!!! Received URL:', url);
        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

        event.preventDefault(); // Prevent default OS handling

        // Optional: Bring window to front when URL is opened
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            // You could send the URL to the renderer process here if needed
            // mainWindow.webContents.send('url-opened', url);
        } else {
            console.log('[Minimal] open-url fired, but mainWindow not available.');
        }
    });
    console.log(`[Minimal] 'open-url' listener ATTACHED.`);

    console.log('[Minimal] Protocol handler setup function complete.');
}

// --- App Lifecycle ---

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
    console.log('[Minimal] App is ready.');
    setupMinimalProtocolHandler(); // Setup protocol handling
    createWindow(); // Create the main window

    // macOS specific: Recreate window when dock icon is clicked and no windows open
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            console.log('[Minimal] Activate event: No windows open, creating one.');
            createWindow();
        } else {
             console.log('[Minimal] Activate event: Window(s) already open.');
        }
    });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    console.log('[Minimal] All windows closed.');
    if (process.platform !== 'darwin') {
        console.log('[Minimal] Quitting app (not macOS).');
        app.quit();
    } else {
        console.log('[Minimal] Not quitting app (macOS behavior).');
    }
});

// Optional: Log when the app quits
app.on('quit', () => {
    console.log('[Minimal] App quit event.');
});

console.log('[Minimal] Main script finished initial execution.');