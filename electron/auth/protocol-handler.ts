// src/main/auth/protocolHandler.ts (Example Path)
import { app, session } from 'electron';
import { net } from 'electron'; // Import net for Electron's net.request API
import { AuthService } from './index'; // Assuming singleton instance export
import { getMainWindowWebContents } from '../main';
import cookieParser, { Cookie as ParsedCookie} from 'set-cookie-parser';

// --- Choose your protocol name consistently ---
const APP_PROTOCOL = 'horizon'; // Make sure this matches what your website redirects to

/**
 * Set up custom protocol handler for successful web auth redirection.
 * This allows the app to intercept URLs like `horizon://auth/success`
 */
export function setupProtocolHandler(): void {
    console.log(`[Protocol Setup] Setting up handler for ${APP_PROTOCOL}://`);

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
            app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [process.argv[1]]);
            console.log(`[Protocol Setup] Registered protocol (dev mode) for ${process.execPath} ${process.argv[1]}`);
        } else {
             console.error('[Protocol Setup] Could not register protocol in dev mode, missing args.');
        }
    } else {
        // If running packaged app
        app.setAsDefaultProtocolClient(APP_PROTOCOL);
         console.log(`[Protocol Setup] Registered protocol (packaged mode).`);
    }
    // --- End Protocol Registration ---


    // --- Function to handle the received URL ---
    const handleAuthSuccessUrl = async (url: string) => {
        console.log(`[Protocol Handler] Received URL: ${url}`);
        // --- Check if it's the specific success URL ---
        if (url.startsWith(`${APP_PROTOCOL}://auth/success`)) {
            console.log('[Protocol Handler] Auth success URL detected. Extracting code and calling backend callback...');
            try {
                // Parse the URL for code and redirect_uri
                const parsedUrl = new URL(url);
                const code = parsedUrl.searchParams.get('code');
                const redirectUri = parsedUrl.searchParams.get('redirect_uri');
                const state = parsedUrl.searchParams.get('state');
                if (!code) {
                    console.error('[Protocol Handler] No code found in URL.');
                    return;
                }
                if (!state) {
                    console.error('[Protocol Handler] No state found in URL.');
                    return;
                }
                // Construct backend callback URL
                const apiUrl = process.env.API_URL || 'https://dbkonobr4m1pp.cloudfront.net';
                const callbackUrlParams = new URLSearchParams({ code, state, redirect_uri: redirectUri || '' });
            const callbackUrl = `${apiUrl}/api/auth/callback?${callbackUrlParams.toString()}`;

            console.log(`[Protocol Handler] Calling backend callback via fetch: ${callbackUrl}`);

            // --- Use fetch to call your backend ---
            const response = await net.fetch(callbackUrl, {
                method: 'GET', // Or 'POST' if your callback expects that
                redirect: 'follow' // Automatically follow redirects if any
                // No 'credentials: include' needed here, we are receiving cookies, not sending initially
            });

            console.log(`[Protocol Handler] Backend callback response status: ${response.status}`);

            // --- Check for failed response from your backend callback ---
            if (!response.ok) {
                let errorBody = `Backend callback failed with status ${response.status}`;
                try {
                    errorBody = await response.text(); // Get error details if possible
                } catch { /* Ignore body read error */ }
                console.error(`[Protocol Handler] Backend callback failed: ${response.status}`, errorBody);
                // TODO: Optionally notify the UI of the login failure
                return; // Stop processing on backend failure
            }

            const setCookieHeaders: string[] = response.headers.getSetCookie(); // Returns array of Set-Cookie strings

            if (setCookieHeaders.length === 0) {
                 console.error('[Protocol Handler] Backend response received, but NO Set-Cookie header found!');
                 return;
            }

            // Parse the cookies using the library (pass the array)
            // *** Use named import 'parse' ***
            const cookiesToSet = cookieParser.parse(setCookieHeaders, {
                 decodeValues: true,
                 map: true // Get map object { cookieName: cookieData }
            });

            // Find the specific WorkOS session cookie
            // *** Use the ParsedCookie type from the library ***
            const wosCookieData: ParsedCookie | undefined = cookiesToSet['wos-session'];

            if (wosCookieData) {
                console.log('[Protocol Handler] Found wos-session cookie in response headers. Details:', wosCookieData);

                const cookieDomainUrl = apiUrl;

                // *** Use Electron.CookiesSetDetails for setting ***
                const cookieDetails: Electron.CookiesSetDetails = {
                    url: cookieDomainUrl,
                    name: wosCookieData.name,
                    value: wosCookieData.value,
                    path: wosCookieData.path || '/',
                    secure: wosCookieData.secure ?? true, // Use ?? for nullish coalescing
                    httpOnly: wosCookieData.httpOnly ?? true,
                    sameSite: mapSameSiteValue(wosCookieData.sameSite)
                };

                // *** Calculate expirationDate (accessing properties on 'ParsedCookie' type) ***
                let expirationTimestampSeconds: number | undefined = undefined;
                // *** Access 'expires' and 'maxAge' from wosCookieData (type ParsedCookie) ***
                if (wosCookieData.expires) {
                     expirationTimestampSeconds = Math.floor(wosCookieData.expires.getTime() / 1000);
                     console.log(`[Protocol Handler] Calculated expirationDate from Expires: ${new Date(expirationTimestampSeconds * 1000).toISOString()}`);
                } else if (wosCookieData.maxAge !== undefined) { // Check maxAge existence
                    expirationTimestampSeconds = Math.floor(Date.now() / 1000) + wosCookieData.maxAge;
                    console.log(`[Protocol Handler] Calculated expirationDate from Max-Age (${wosCookieData.maxAge}s): ${new Date(expirationTimestampSeconds * 1000).toISOString()}`);
                }

                if (expirationTimestampSeconds !== undefined) {
                    cookieDetails.expirationDate = expirationTimestampSeconds;
                } else {
                    console.warn('[Protocol Handler] No Expires or Max-Age found for wos-session cookie. Treating as session cookie.');
                }

                console.log('[Protocol Handler] Attempting to set cookie in Electron session:', cookieDetails);
                try {
                    // *** Explicitly save the cookie to Electron's default session ***
                    await session.defaultSession.cookies.set(cookieDetails);
                    console.log('[Protocol Handler] Successfully set wos-session cookie in Electron store.');

                    // Now that the cookie is set, verify the auth status
                    const auth = AuthService.getInstance();
                    auth.checkAuthStatus().then((isValid: boolean) => {
                        console.log(`[Protocol Handler] checkAuthStatus completed after cookie set. Valid session: ${isValid}`);
                        if (isValid) {
                            // TODO: Notify the renderer/UI that login was successful
                            // Example: getMainWindowWebContents()?.send('auth:login-success');
                        } else {
                             console.error('[Protocol Handler] checkAuthStatus returned false immediately after setting cookie.');
                             // This would be unusual but indicates another issue
                        }
                    }).catch((error: unknown) => {
                        console.error('[Protocol Handler] Error during checkAuthStatus triggered by protocol:', error);
                    });

                } catch (cookieSetError) {
                    console.error('[Protocol Handler] Failed to set cookie in Electron store:', cookieSetError);
                    // TODO: Notify UI of error?
                }

            } else {
                console.error('[Protocol Handler] Critical: Did not find "wos-session" cookie in backend response headers!');
                // Handle login failure - backend didn't send the expected cookie
                 // TODO: Notify UI of error?
            }

        } catch (error) {
            console.error('[Protocol Handler] Error handling auth success URL:', error);
             // TODO: Notify UI of error?
        }
    } else {
        console.warn(`[Protocol Handler] Received URL for '${APP_PROTOCOL}' but path is not recognized: ${url}`);
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
}

function mapSameSiteValue(value?: string): Electron.CookiesSetDetails['sameSite'] {
    const lowerValue = value?.toLowerCase();
    if (lowerValue === 'none') {
        // Map standard 'None' to Electron's 'no_restriction'
        return 'no_restriction';
    }
    if (lowerValue === 'lax') {
        return 'lax';
    }
    if (lowerValue === 'strict') {
        return 'strict';
    }
    // Default if unspecified or unrecognized by parser
    console.warn(`[SameSite Mapping] Unrecognized or missing SameSite value '${value}', defaulting to 'unspecified'. Check backend Set-Cookie header.`);
    // 'unspecified' is often the safest default if the backend doesn't send SameSite
    return 'unspecified';
}