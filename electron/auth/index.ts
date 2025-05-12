import { app, shell, net, session, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import DatabaseService from '../data';
import { base64UrlEncode, generateRandomString, getAccessToken, getRefreshToken, setStore, sha256 } from '../utils/helpers';
import { exec } from 'child_process';

// --- Store User Info locally if needed (optional caching) ---
const USER_INFO_FILE = path.join(app.getPath('userData'), 'auth', 'user-info.json');
export type User = any;

export class AuthService {
  private static instance: AuthService;

  // --- In-memory state ---
  private authenticated: boolean = false;
  private isLoading: boolean = true; // Start as loading

  // --- Keep track of the main window to send messages ---
  private mainWindow: Electron.BrowserWindow | null = null;

  private constructor() {
    // Create auth directory if it doesn't exist
    const authDir = path.dirname(USER_INFO_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    // Try to load cached user info and notify instantly
    if (fs.existsSync(USER_INFO_FILE)) {
      try {
        const user = JSON.parse(fs.readFileSync(USER_INFO_FILE, 'utf-8'));
        if (user && user.id) {
          this.currentUser = user;
          this.authenticated = true;
          this.isLoading = false;
          this.notifyStatusChange(); // Notify renderer immediately on startup
        }
      } catch (e) {
        console.error('Failed to load cached user info:', e);
      }
    }
    console.log("AuthService initialized.");
  }
  
  public currentUser: any | null = null;

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  public setMainWindow(window: Electron.BrowserWindow | null) {
      this.mainWindow = window;
      // Immediately notify newly set window of current status
      if (this.mainWindow) {
          this.notifyStatusChange();
      }
  }

  public async checkAuthStatus(): Promise<boolean> {
    this.isLoading = true;
    this.notifyStatusChange(); // Notify loading start

    const meUrl = `${process.env.API_URL}/api/auth/me`;
    const accessToken = getAccessToken();
    try {
        const response = await net.fetch(meUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
        });

        // Reset auth state before processing response
        this.currentUser = null;
        this.authenticated = false;

        if (response.ok) { // Checks for 200-299 status
            const userData = await response.json();

            // Process user data (handle different shapes)
            let user = null;
            if (userData?.user?.id) { // Optional chaining for safety
                user = userData.user;
            } else if (userData?.id) {
                user = userData;
            }

            if (user) {
                this.currentUser = user;
                // Assuming DatabaseService is available and method is safe
                DatabaseService.getInstance().upsertUserFromServer(user);
                this.authenticated = true; // Set state AFTER successful processing

                // Persist user info
                try {
                    fs.writeFileSync(USER_INFO_FILE, JSON.stringify(user), 'utf-8');
                } catch (e) {
                    console.error('Failed to persist user info:', e);
                    // Decide if this failure should affect auth status
                }
            } else {
                console.error('AuthService: Invalid user data received from /me');
                // Auth state already set to false
            }
        } else {
            // Auth state already set to false
        }

    } catch (error) {
        this.currentUser = null; // Ensure cleanup on error
        this.authenticated = false;
    } finally {
        this.isLoading = false;
        // Notify status change *after* potentially updating authenticated state
        this.notifyStatusChange();
    }

    // Return the final determined authentication state
    return this.authenticated;
}

public async initiateOAuth(): Promise<void> {
    try {
    const codeVerifier = generateRandomString(128); // Generate a 128-char random string

    // 2. Generate Code Challenge
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64UrlEncode(hashed);

    // 3. Generate State
    const state = generateRandomString(32); // Generate a 32-char random string for state

    // 4. Store Verifier and State in AuthService instance
    setStore('codeVerifier', codeVerifier);
    setStore('state', state);

    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!clientId) {
      console.error('Missing WORKOS_CLIENT_ID env var');
      return;
    }
    const redirectUri = process.env.FRONTEND_URL + '/loginDeepUrl';
    const workosAuthorizeUrl = 'https://api.workos.com/user_management/authorize';

    // 6. Construct URL Parameters
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state, // Use the generated state
      // PKCE Parameters
      provider: 'authkit', // Or the specific provider/connection if needed
      code_challenge: codeChallenge, // Use the generated challenge
      code_challenge_method: 'S256',
    });
    
    // 7. Construct Final URL
    const authorizationUrl = `${workosAuthorizeUrl}?${params.toString()}`;

    // 8. Redirect User
    console.log('Constructed WorkOS Authorization URL:', authorizationUrl);
    app.isPackaged ? await shell.openExternal(authorizationUrl) : exec(`open -a "Arc" "${authorizationUrl}"`);
  } catch (error) {
    console.error('AuthService: Failed to open external browser:', error);
  }
  }

  public async logout(): Promise<void> {
    console.log('AuthService: Logging out...');
    const wasAuthenticated = this.authenticated;
    this.currentUser = null;
    this.authenticated = false;

    // Notify backend to clear the HttpOnly cookie
    const API_URL = process.env.API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
    try {
        console.log("AuthService: Calling backend logout...");
        const request = net.request({
            method: 'POST', // Or GET, match your backend logout handler
            url: `${API_URL}/api/auth/logout`,
            session: session.defaultSession,
            useSessionCookies: true,
        });

        request.on('response', (response) => {
            console.log(`AuthService: Backend logout response status: ${response.statusCode}`);
            response.on('data', () => {}); // Consume data
            response.on('end', () => console.log("AuthService: Backend logout finished."));
        });
        request.on('error', (error: Error) => {
            console.error('AuthService: Backend logout request error:', error);
        });
        request.end();

        // Optionally clear cookies explicitly from Electron's session storage
        try {
            const apiUrlObj = new URL(API_URL);
            const cookies = await session.defaultSession.cookies.get({ domain: apiUrlObj.hostname });
            console.log(`Found ${cookies.length} cookies for domain ${apiUrlObj.hostname}`);
            for (const cookie of cookies) {
                // Be careful with the URL format required by remove
                let urlToRemove = `${apiUrlObj.protocol}//${cookie.domain}${cookie.path}`;
                console.log(`Removing cookie: ${cookie.name} from ${urlToRemove}`);
                await session.defaultSession.cookies.remove(urlToRemove, cookie.name);
            }
             console.log("AuthService: Attempted to clear session cookies.");
        } catch(cookieError) {
            console.error("AuthService: Error clearing cookies", cookieError);
        }

    } catch (error) {
      console.error('AuthService: Error initiating backend logout:', error);
    } finally {
       if (wasAuthenticated) {
           this.notifyStatusChange(); // Notify renderer only if state actually changed
       }
    }
  }

  /**
   * Check if the user is currently considered authenticated based on state
   */
  public isAuthenticated(): boolean {
    // Optionally add a check against isLoading?
    // return !this.isLoading && this.authenticated;
    return this.authenticated;
  }

  /**
   * Get the user object
   */
  public getUser(): any | null {
    return this.currentUser;
  }

  /**
   * Get the user ID
   */
  public getUserId(): string | null {
    return this.currentUser?.id || null;
  }

   /**
   * Get the current loading state
   */
  public getIsLoading(): boolean {
    return this.isLoading;
  }


  // --- Helper to notify renderer process(es) of state changes ---
  private notifyStatusChange(): void {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          console.log(`AuthService: Notifying window ${this.mainWindow.id} of status change:`, { auth: this.authenticated, loading: this.isLoading, user: this.currentUser?.id });
          this.mainWindow.webContents.send('auth-status-changed', {
              isAuthenticated: this.authenticated,
              isLoading: this.isLoading,
              user: this.currentUser // Send the whole user object
          });
      } else {
          // console.warn("AuthService: Cannot notify status change, main window not set or destroyed.");
          // Attempt to find any window if mainWindow isn't set/valid (less ideal)
          const allWindows = BrowserWindow.getAllWindows();
           if (allWindows.length > 0 && !allWindows[0].isDestroyed()) {
               console.log(`AuthService: Notifying window ${allWindows[0].id} (fallback) of status change.`);
               allWindows[0].webContents.send('auth-status-changed', {
                  isAuthenticated: this.authenticated,
                  isLoading: this.isLoading,
                  user: this.currentUser
              });
           } else {
                console.warn("AuthService: Cannot notify status change, no valid windows found.");
           }
      }
  }

}
