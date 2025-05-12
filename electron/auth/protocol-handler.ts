// src/main/auth/protocolHandler.ts (Example Path)
import { app, safeStorage } from 'electron';
import { net } from 'electron'; // Import net for Electron's net.request API
import { AuthService } from './index'; // Assuming singleton instance export
import { getMainWindow, getMainWindowWebContents } from '../main';
import { setTokens, getStore, deleteStore, getAccessToken } from '../utils/helpers';
import path from 'path';

// --- Choose your protocol name consistently ---
const APP_PROTOCOL = 'horizon'; // Make sure this matches what your website redirects to

/**
 * Set up custom protocol handler for successful web auth redirection.
 * This allows the app to intercept URLs like `horizon://auth/success`
 */
export function setupProtocolHandler() {
    // Ensure only one instance runs (important for protocol handling)
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        console.log('[Protocol Setup] Another instance is already running, quitting this one.');
        app.quit();
        return; // Stop setup if not the primary instance
    }

    // --- Protocol Registration ---
    // Force removal first for clean state, especially during development
    app.removeAsDefaultProtocolClient(APP_PROTOCOL);

    // Register the custom protocol
    if (process.defaultApp) {
        // If running in development (e.g., with electron-forge start)
        if (process.argv.length >= 2) {
            const rawArg = process.argv[1] || '';
            const resolvedArg = path.resolve(rawArg);
            console.log(`[Protocol Setup] Registering '${APP_PROTOCOL}' protocol in dev mode with execPath=${process.execPath}, rawArg=${rawArg}, resolvedArg=${resolvedArg}`);
            const registrationSuccess = app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [resolvedArg]);
            console.log(`[Protocol Setup] app.setAsDefaultProtocolClient (dev) returned: ${registrationSuccess}`);
        } else {
            console.error('[Protocol Setup] Could not register protocol in dev mode, missing args.');
        }
    } else {
        // If running packaged app
        console.log(`[Protocol Setup] Registering '${APP_PROTOCOL}' protocol in packaged mode`);
        const registrationSuccess = app.setAsDefaultProtocolClient(APP_PROTOCOL);
        console.log(`[Protocol Setup] app.setAsDefaultProtocolClient (prod) returned: ${registrationSuccess}`);
    }
    // --- End Protocol Registration ---

    console.log('[Protocol Setup] Protocol handler setup complete for ' + APP_PROTOCOL + ' protocol.');

    // Verify registration status after delay
    setTimeout(() => {
        const isRegistered = app.isDefaultProtocolClient(APP_PROTOCOL);
        console.log(`[Protocol Setup] isDefaultProtocolClient('${APP_PROTOCOL}') after delay: ${isRegistered}`);
    }, 1000);

    // --- Function to handle the received URL ---
    const handleAuthSuccessUrl = async (url: string) => {
        if (url.startsWith(`${APP_PROTOCOL}://auth/success`)) {
            console.log('[Protocol Handler] Auth success URL detected. Extracting code and calling backend callback...');
            try {
                // Parse the URL for code and redirect_uri
                const parsedUrl = new URL(url);
                const code = parsedUrl.searchParams.get('code');
                const state = parsedUrl.searchParams.get('state');
                if (!code) {
                    console.error('[Protocol Handler] No code found in URL.');
                    return;
                }
                if (!state) {
                    console.error('[Protocol Handler] No state found in URL.');
                    return;
                }

                console.log('[Protocol Handler] Extracted code:', code);
                console.log('[Protocol Handler] Extracted state:', state);
                console.log('[Protocol Handler] Extracted state:', getStore('state'));

                if(state !== getStore('state')) {
                    console.error('[Protocol Handler] State mismatch in callback URL.');
                    return;
                }

                deleteStore('codeVerifier');
                deleteStore('state');
                
            // --- Use fetch to call your backend ---
            const response = await net.fetch(process.env.API_URL + '/api/auth/token', {
                method: 'POST',
                body: JSON.stringify({ code, from: "electron" }),
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                console.error('[Protocol Handler] Failed to fetch token:', response.status, response.statusText);
                return;
            }

            const data = await response.json();

            const { accessToken, refreshToken } = data;
            if(!accessToken || !refreshToken) {
                console.error('[Protocol Handler] Invalid response from backend callback:', data);
                return;
            }

            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('Encryption is not available on this system');
              }

            // Set access token and refresh token in session
            setTokens(accessToken, refreshToken);

            if(!await AuthService.getInstance().checkAuthStatus()) {
                console.error('[Protocol Handler] Failed to check auth status after callback.');
                return;
            }
        } catch (error) {
            console.error('[Protocol Handler] Error handling auth success URL:', error);
        }
    }
    };


    // --- Event Listeners ---

    // 1. macOS: Handle when app is already running
    app.on('open-url', (event, url) => {
        console.log('[Protocol Handler] Event: open-url (macOS)');
        event.preventDefault(); // We are handling it
        handleAuthSuccessUrl(url);
    });

    // 2. Windows/Linux: Handle when app is already running (second instance tries to launch)
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('[Protocol Handler] Event: second-instance (Win/Linux)');

        const mainWindow = getMainWindow();
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            console.log('[Protocol Handler] Focused main window.');
        } else {
            console.warn('[Protocol Handler] Could not find main window to focus.');
        }

        // Find the protocol URL in the command line arguments
        const url = commandLine.find(arg => arg.startsWith(`${APP_PROTOCOL}://`));
        if (url) {
            handleAuthSuccessUrl(url);
        } else {
             console.warn('[Protocol Handler] No protocol URL found in second-instance args:', commandLine);
        }
    });

    // 3. Windows/Linux: Handle when app is launched via protocol URL
    // Check command line arguments passed at startup
    const argv = process.argv;
    const startupUrl = argv.find(arg => arg.startsWith(`${APP_PROTOCOL}://`));

    if (startupUrl) {
        console.log(`[Protocol Handler] Found startup URL in argv: ${startupUrl}`);
        // Use app.whenReady() to ensure app modules (like AuthService) are initialized
        app.whenReady().then(() => {
             console.log('[Protocol Handler] App ready, handling startup URL.');
            // No need for setTimeout usually if using whenReady correctly
            handleAuthSuccessUrl(startupUrl);
        }).catch(err => {
            console.error('[Protocol Handler] Error during app.whenReady for startup URL:', err);
        });
    } else {
        console.log(`[Protocol Handler] No ${APP_PROTOCOL}:// URL found in startup arguments.`);
    }
};