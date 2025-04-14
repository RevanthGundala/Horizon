// src/main/auth/AuthService.ts (Example Path)
import { app, shell, net, session, BrowserWindow } from 'electron'; // Added net, session
import path from 'path';
import fs from 'fs';
// Removed crypto as we are not encrypting/decrypting the session token locally anymore

// --- Store User Info locally if needed (optional caching) ---
const USER_INFO_FILE = path.join(app.getPath('userData'), 'auth', 'user-info.json');
export type User = any;

export class AuthService {
  private static instance: AuthService;

  // --- In-memory state ---
  private authenticated: boolean = false;
  private isLoading: boolean = true; // Start as loading

  // --- Keep track of the main window to send messages ---
  // You need a way to set this from your main process setup
  private mainWindow: Electron.BrowserWindow | null = null;

  private constructor() {
    // Create auth directory if it doesn't exist
    const authDir = path.dirname(USER_INFO_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
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

  // --- Method to set the main window reference ---
  public setMainWindow(window: Electron.BrowserWindow | null) {
      this.mainWindow = window;
      // Immediately notify newly set window of current status
      if (this.mainWindow) {
          this.notifyStatusChange();
      }
  }

  // --- NEW: Method to check auth status against the backend /me endpoint ---
  public async checkAuthStatus(): Promise<boolean> {
    console.log('AuthService: Checking auth status...');
    this.isLoading = true;
    this.notifyStatusChange(); // Notify loading start

    const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage'; // Ensure this is correct

    try {
      // Use Electron's net module to ensure cookie handling from the default session
      const request = net.request({
          method: 'GET',
          url: `${API_URL}/api/users/me`,
          // Use the default session which *should* have the HttpOnly cookie if set correctly by the web flow for the API domain
          session: session.defaultSession,
          useSessionCookies: true, // Explicitly use session cookies
      });

      // Add necessary headers (Origin might not be strictly needed/possible from main process like this)
      // request.setHeader('Content-Type', 'application/json');
      // request.setHeader('Accept', 'application/json');
      // request.setHeader('Origin', 'electron://app'); // Origin header might be restricted

      let responseBody = '';
      let statusCode = 0;

      return new Promise<boolean>((resolve) => {
          request.on('response', (response) => {
              statusCode = response.statusCode;
              console.log(`AuthService: /me response status: ${statusCode}`);
              response.on('data', (chunk) => {
                  responseBody += chunk;
              });
              response.on('end', () => {
                  console.log('AuthService: /me response ended.');
                  if (statusCode >= 200 && statusCode < 300) {
                      try {
                          const userData = JSON.parse(responseBody);
                          console.log('AuthService: /me response data:', userData);
                          // Accept either { user: { id, email } } or { id, email }
                          let user = null;
                          if (userData && userData.user && userData.user.id) {
                              user = userData.user;
                          } else if (userData && userData.id) {
                              user = userData;
                          }
                          if (user && user.id) {
                              this.currentUser = user;
                              this.authenticated = true;
                              console.log('AuthService: Authentication successful.', user.id);
                              resolve(true);
                          } else {
                             console.error('AuthService: Invalid user data received from /me');
                             this.currentUser = null;
                             this.authenticated = false;
                             resolve(false);
                          }
                      } catch (parseError) {
                          console.error('AuthService: Failed to parse /me response:', parseError);
                          resolve(false);
                      }
                  } else {
                      console.log('AuthService: Authentication failed (non-2xx status).');
                      resolve(false);
                  }
                  this.isLoading = false;
                  this.notifyStatusChange(); // Notify loading end and status change
              });
              response.on('error', (error: Error) => {
                   console.error('AuthService: /me response error:', error);
                   this.isLoading = false;
                   this.notifyStatusChange();
                   resolve(false);
              });
          });

          request.on('error', (error: Error) => {
              console.error('AuthService: /me request error:', error);
                this.isLoading = false;
              this.notifyStatusChange();
              resolve(false);
          });

          request.end(); // Send the request
          console.log("AuthService: /me request sent.");
      });

    } catch (error) {
      console.error('AuthService: Unexpected error in checkAuthStatus:', error);
      this.isLoading = false;
      this.notifyStatusChange();
      return false;
    }
  }

  /**
   * --- MODIFIED: Initiate the OAuth flow via the WEBSITE ---
   */
  public async initiateOAuth(): Promise<void> {
    console.log('AuthService: Initiating OAuth via website...');
    // URL of your website page that handles distinguishing electron vs web
    const websiteInitiationUrl = `${process.env.API_URL}/api/auth/login?from=electron`;

    try {
      // Open the URL in the user's default system browser
      await shell.openExternal(websiteInitiationUrl);
      console.log(`AuthService: Opened external browser to ${websiteInitiationUrl}`);
    } catch (error) {
      console.error('AuthService: Failed to open external browser:', error);
      // Handle error (e.g., show message to user)
    }
    // Note: We no longer create an Electron authWindow or intercept navigation here.
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
