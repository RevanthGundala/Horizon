import { app, shell, net, session, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import DatabaseService from '../data';

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
    console.log('AuthService: Checking auth status...');
    this.isLoading = true;
    this.notifyStatusChange(); // Notify loading start

    const API_URL = process.env.API_URL;
    if (!API_URL) {
         console.error("API_URL environment variable not set! Cannot check auth status.");
         this.isLoading = false;
         this.notifyStatusChange();
         this.authenticated = false; // Ensure state is false
         return false;
    }

    const meUrl = `${API_URL}/api/users/me`;

    try {
        console.log(`AuthService: Sending request to ${meUrl}`);
        const response = await net.fetch(meUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
            },
        });

        console.log(`AuthService: /me response status: ${response.status}`);

        // Reset auth state before processing response
        this.currentUser = null;
        this.authenticated = false;

        if (response.ok) { // Checks for 200-299 status
            const userData = await response.json();
            console.log('AuthService: /me response data:', userData);

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
                console.log('AuthService: Authentication successful.', user.id);

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
            console.log(`AuthService: Authentication failed (status: ${response.status}). Response: ${await response.text()}`);
            // Auth state already set to false
        }

    } catch (error) {
        console.error('AuthService: Error during fetch to /me:', error);
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

  /**
   * --- MODIFIED: Initiate the OAuth flow via the WEBSITE ---
   */
  public async initiateOAuth(): Promise<void> {
    console.log('AuthService: Initiating OAuth via website...');
    const websiteInitiationUrl = `${process.env.API_URL}/api/auth/login?from=electron`;

    try {
      await shell.openExternal(websiteInitiationUrl);
      console.log(`AuthService: Opened external browser to ${websiteInitiationUrl}`);
    } catch (error) {
      console.error('AuthService: Failed to open external browser:', error);
    }
  }

  /**
   * --- MODIFIED: Logout ---
   */
  public async logout(): Promise<void> {
    console.log('AuthService: Logging out...');
    const wasAuthenticated = this.authenticated;
    this.currentUser = null;
    this.authenticated = false;

    // Notify backend to clear the HttpOnly cookie
    const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
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
