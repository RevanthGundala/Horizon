// src/main/auth/protocolHandler.ts (Example Path)
import { app, session } from 'electron';
import { net } from 'electron'; // Import net for Electron's net.request API
import { AuthService } from './index'; // Assuming singleton instance export
import { getMainWindowWebContents } from '../main';

// --- Choose your protocol name consistently ---
const MY_APP_PROTOCOL = 'horizon'; // Make sure this matches what your website redirects to

/**
 * Set up custom protocol handler for successful web auth redirection.
 * This allows the app to intercept URLs like `horizon://auth/success`
 */
export function setupProtocolHandler(): void {
    console.log(`[Protocol Setup] Setting up handler for ${MY_APP_PROTOCOL}://`);

    // Ensure only one instance runs (important for protocol handling)
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        console.log('[Protocol Setup] Another instance is already running, quitting this one.');
        app.quit();
        return; // Stop setup if not the primary instance
    }

    // --- Protocol Registration ---
    // Force removal first for clean state, especially during development
    app.removeAsDefaultProtocolClient(MY_APP_PROTOCOL);

    // Register the custom protocol
    if (process.defaultApp) {
        // If running in development (e.g., with electron-forge start)
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(MY_APP_PROTOCOL, process.execPath, [process.argv[1]]);
            console.log(`[Protocol Setup] Registered protocol (dev mode) for ${process.execPath} ${process.argv[1]}`);
        } else {
             console.error('[Protocol Setup] Could not register protocol in dev mode, missing args.');
        }
    } else {
        // If running packaged app
        app.setAsDefaultProtocolClient(MY_APP_PROTOCOL);
         console.log(`[Protocol Setup] Registered protocol (packaged mode).`);
    }
    // --- End Protocol Registration ---


    // --- Function to handle the received URL ---
    const handleAuthSuccessUrl = async (url: string) => {
        console.log(`[Protocol Handler] Received URL: ${url}`);
        // --- Check if it's the specific success URL ---
        if (url.startsWith(`${MY_APP_PROTOCOL}://auth/success`)) {
            console.log('[Protocol Handler] Auth success URL detected. Extracting code and calling backend callback...');
            try {
                // Parse the URL for code and redirect_uri
                const parsedUrl = new URL(url);
                const code = parsedUrl.searchParams.get('code');
                const redirectUri = parsedUrl.searchParams.get('redirect_uri');
                if (!code) {
                    console.error('[Protocol Handler] No code found in URL.');
                    return;
                }
                // Construct backend callback URL
                const apiUrl = process.env.API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
                const callbackUrl = `${apiUrl}/api/auth/callback?code=${encodeURIComponent(code)}${redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : ''}`;

                // Use Electron's net.request to call backend and set cookies in Electron session
                const request = net.request({
                    method: 'GET',
                    url: callbackUrl,
                    session: session.defaultSession,
                    useSessionCookies: true,
                });

                request.on('response', (response) => {
                    let body = '';
                    response.on('data', (chunk) => {
                        body += chunk;
                    });
                    response.on('end', () => {
                        if (response.statusCode < 200 || response.statusCode >= 300) {
                            console.error(`[Protocol Handler] Backend callback failed: ${response.statusCode}`);
                            try { console.error('Error details:', body && JSON.parse(body)); } catch (e) {}
                            return;
                        }
                        console.log('[Protocol Handler] Backend callback succeeded, session cookie should now be set.');
                        // --- Trigger the /me check ---
                        const auth = AuthService.getInstance();
                        auth.checkAuthStatus().then((isValid: boolean) => {
                            console.log(`[Protocol Handler] checkAuthStatus completed. Valid session: ${isValid}`);
                        }).catch((error: unknown) => {
                            console.error('[Protocol Handler] Error during checkAuthStatus triggered by protocol:', error);
                        });
                    });
                });

                request.on('error', (error) => {
                    console.error('[Protocol Handler] net.request error:', error);
                });

                request.end();
            } catch (error) {
                console.error('[Protocol Handler] Error handling auth success URL:', error);
            }
        } else {
            console.warn(`[Protocol Handler] Received URL for '${MY_APP_PROTOCOL}' but path is not recognized: ${url}`);
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

        const mainWindow = getMainWindowWebContents();
        if (mainWindow) {
            mainWindow.focus();
            console.log('[Protocol Handler] Focused main window.');
        } else {
            console.warn('[Protocol Handler] Could not find main window to focus.');
        }

        // Find the protocol URL in the command line arguments
        const url = commandLine.find(arg => arg.startsWith(`${MY_APP_PROTOCOL}://`));
        if (url) {
            handleAuthSuccessUrl(url);
        } else {
             console.warn('[Protocol Handler] No protocol URL found in second-instance args:', commandLine);
        }
    });

    // 3. Windows/Linux: Handle when app is launched via protocol URL
    // Check command line arguments passed at startup
    const argv = process.argv;
    const startupUrl = argv.find(arg => arg.startsWith(`${MY_APP_PROTOCOL}://`));

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
        console.log(`[Protocol Handler] No ${MY_APP_PROTOCOL}:// URL found in startup arguments.`);
    }
    // --- End Event Listeners ---

    console.log("[Protocol Setup] Protocol handler setup complete.");
}