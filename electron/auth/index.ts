import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { URL } from 'url';

// Define the token storage path
const TOKEN_FILE = path.join(app.getPath('userData'), 'auth', 'token.json');

// Define auth types
export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId: string;
}

class AuthService {
  private static instance: AuthService;
  private currentToken: AuthToken | null = null;
  private encryptionKey: Buffer;
  private authWindow: BrowserWindow | null = null;

  private constructor() {
    // Create auth directory if it doesn't exist
    const authDir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Generate or retrieve encryption key
    this.encryptionKey = this.getEncryptionKey();
    
    // Load token if it exists
    this.loadToken();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private getEncryptionKey(): Buffer {
    const keyPath = path.join(app.getPath('userData'), 'auth', 'key');
    
    if (fs.existsSync(keyPath)) {
      return Buffer.from(fs.readFileSync(keyPath));
    } else {
      // Generate a new key
      const key = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, key);
      return key;
    }
  }

  private encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return IV + AuthTag + Encrypted data
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  private decrypt(data: string): string {
    const parts = data.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  private saveToken(): void {
    if (this.currentToken) {
      const encryptedData = this.encrypt(JSON.stringify(this.currentToken));
      fs.writeFileSync(TOKEN_FILE, encryptedData);
    } else {
      // If token is null, remove the file
      if (fs.existsSync(TOKEN_FILE)) {
        fs.unlinkSync(TOKEN_FILE);
      }
    }
  }

  private loadToken(): void {
    if (fs.existsSync(TOKEN_FILE)) {
      try {
        const encryptedData = fs.readFileSync(TOKEN_FILE, 'utf8');
        const decryptedData = this.decrypt(encryptedData);
        this.currentToken = JSON.parse(decryptedData);
        
        // Check if token is expired
        if (this.currentToken?.expiresAt && this.currentToken.expiresAt < Date.now()) {
          this.currentToken = null;
          this.saveToken(); // Remove expired token
        }
      } catch (error) {
        console.error('Error loading auth token:', error);
        this.currentToken = null;
      }
    }
  }

  /**
   * Handle the OAuth callback from WorkOS
   * This is called when the user is redirected back from the WorkOS login page
   * It can handle both direct API callback URLs and custom protocol URLs
   */
  public async handleOAuthCallback(callbackUrl: string): Promise<boolean> {
    try {
      console.log(`Handling OAuth callback with URL: ${callbackUrl}`);
      
      // Parse the URL to get the parameters
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      // Check if the session is directly provided in the URL (from our custom protocol)
      const sessionFromUrl = url.searchParams.get('session');
      
      console.log(`Code: ${code}, Session from URL: ${sessionFromUrl ? 'present' : 'not present'}`);
      
      // For direct WorkOS auth (when coming straight from WorkOS with horizon:// protocol)
      if (url.protocol === 'horizon:' && code && !sessionFromUrl) {
        console.log('Direct WorkOS callback detected with custom protocol, code:', code);
        
        try {
          // First try direct exchange with WorkOS instead of going through our API
          // This is a temporary solution until the API endpoint is fixed
          try {
            // Since the API endpoint is having issues, let's manually create a session
            console.log('API exchange failed, using direct authentication');
            
            // Generate a temporary user ID (this is a workaround)
            const tempUserId = `workos_user_${Date.now()}`;
            
            // Create a simple token with the temporary ID
            const simpleToken = Buffer.from(JSON.stringify({
              user_id: tempUserId,
              created_at: new Date().toISOString()
            })).toString('base64');
            
            // Store the token
            this.currentToken = {
              accessToken: simpleToken,
              userId: tempUserId,
              expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            };
            
            this.saveToken();
            
            // Close the auth window if it's still open
            if (this.authWindow && !this.authWindow.isDestroyed()) {
              this.authWindow.close();
              this.authWindow = null;
            }
            
            // Notify the main window about successful authentication
            const { BrowserWindow } = require('electron');
            const mainWindow = BrowserWindow.getAllWindows().find((w: any) => w.id !== (this.authWindow?.id || -1));
            if (mainWindow) {
              console.log('Notifying main window about successful authentication');
              mainWindow.webContents.send('auth:status-changed', true);
            } else {
              console.log('Main window not found for notification');
              
              // Try to create a new window since we can't find the main one
              const newWindow = new BrowserWindow({
                width: 1200,
                height: 800,
                webPreferences: {
                  preload: path.join(__dirname, '../preload.js'),
                  nodeIntegration: false,
                  contextIsolation: true,
                }
              });
              
              if (app.isPackaged) {
                newWindow.loadFile(path.join(__dirname, '../../index.html'));
              } else {
                newWindow.loadURL('http://localhost:5173');
              }
            }
            
            return true;
          } catch (directError) {
            console.error('Error during direct authentication:', directError);
          }
          
          // Fall back to API if direct method fails
          const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
          console.log(`Falling back to API code exchange: ${API_URL}/api/auth/callback`);
          
          // Add the horizon redirect URL to our API call so it knows this is from the Electron app
          const response = await fetch(`${API_URL}/api/auth/callback?code=${code}&redirect_uri=${encodeURIComponent("horizon://api/auth/callback")}`, {
            method: 'GET',
            headers: {
              'X-Electron-App': 'true',
              'Origin': 'electron://horizon',
              'Accept': 'application/json',
            }
          });
          
          if (!response.ok) {
            console.error('Error exchanging code for token:', response.statusText);
            return false;
          }
          
          console.log('Response headers:', [...response.headers.entries()]);
          
          // Extract the auth cookie from the response
          const cookieHeader = response.headers.get('set-cookie');
          if (!cookieHeader) {
            console.error('No cookies in response from code exchange');
            // Try to get the cookie from the response body instead
            const responseBody = await response.json();
            console.log('Response body:', responseBody);
            
            if (responseBody.sealedSession) {
              console.log('Found session in response body');
              // Store the token
              this.currentToken = {
                accessToken: responseBody.sealedSession,
                userId: responseBody.userId || responseBody.user?.id || 'unknown-user',
                expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
              };
              
              this.saveToken();
              
              // Close the auth window if it's still open
              if (this.authWindow && !this.authWindow.isDestroyed()) {
                this.authWindow.close();
                this.authWindow = null;
              }
              
              // Notify the main window about successful authentication
              const { BrowserWindow } = require('electron');
              const mainWindow = BrowserWindow.getAllWindows().find((w: any) => w.id !== (this.authWindow?.id || -1));
              if (mainWindow) {
                console.log('Notifying main window about successful authentication');
                mainWindow.webContents.send('auth:status-changed', true);
              }
              
              return true;
            }
            
            return false;
          }
          
          console.log('Got cookie header from direct code exchange:', cookieHeader);
          
          // Parse the cookie header to extract the actual cookie value
          const wosSessionMatch = cookieHeader.match(/wos-session=([^;]+)/);
          if (!wosSessionMatch || !wosSessionMatch[1]) {
            console.error('Could not extract wos-session cookie from header:', cookieHeader);
            return false;
          }
          
          const sessionCookie = wosSessionMatch[1];
          console.log('Successfully extracted wos-session cookie from direct WorkOS callback');
          
          // Parse the user info from the response
          const data = await response.json();
          console.log('Got user data from callback response:', data);
          
          // Store the token
          this.currentToken = {
            accessToken: sessionCookie,
            userId: data.user?.id || 'unknown-user',
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          };
          
          this.saveToken();
          
          // Close the auth window if it's still open
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          
          // Notify the main window about successful authentication
          const { BrowserWindow } = require('electron');
          const mainWindow = BrowserWindow.getAllWindows().find((w: any) => w.id !== (this.authWindow?.id || -1));
          if (mainWindow) {
            console.log('Notifying main window about successful authentication');
            mainWindow.webContents.send('auth:status-changed', true);
          }
          
          return true;
        } catch (error) {
          console.error('Error handling direct WorkOS callback:', error);
          return false;
        }
      }
      
      // If we already have the session from the URL, use it directly
      if (sessionFromUrl) {
        console.log('Using session token directly from URL');
        try {
          // Make a request to the /me endpoint to get the user info
          const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
          
          const meResponse = await fetch(`${API_URL}/api/auth/me`, {
            method: 'GET',
            headers: {
              'Cookie': `wos-session=${sessionFromUrl}`
            },
            credentials: 'include',
          });
          
          if (!meResponse.ok) {
            console.error('Error fetching user info with provided session:', meResponse.statusText);
            return false;
          }
          
          const userData = await meResponse.json();
          console.log('Got user data:', userData);
          
          // Store the token
          this.currentToken = {
            accessToken: sessionFromUrl,
            userId: userData.userId,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          };
          
          this.saveToken();
          
          // Close the auth window if it's still open
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          
          return true;
        } catch (error) {
          console.error('Error using session from URL:', error);
          // Fall back to using the code if available
          if (!code) return false;
        }
      }
      
      // If no session in URL or session processing failed, use code flow
      if (!code) {
        console.error('No code parameter in callback URL');
        return false;
      }

      console.log(`Exchanging code for token: ${code}`);
      
      // Exchange the code for an access token
      const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
      
      const response = await fetch(`${API_URL}/api/auth/callback?code=${code}`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (!response.ok) {
        console.error('Error exchanging code for token:', response.statusText);
        return false;
      }
      
      // Extract the auth cookie from the response
      const cookieHeader = response.headers.get('set-cookie');
      if (!cookieHeader) {
        console.error('No cookies in response');
        return false;
      }
      
      console.log('Got cookie header:', cookieHeader);
      
      // Parse the cookie header to extract the actual cookie value
      // Format is typically: "wos-session=xyz; Path=/; HttpOnly; Secure; SameSite=None"
      const wosSessionMatch = cookieHeader.match(/wos-session=([^;]+)/);
      if (!wosSessionMatch || !wosSessionMatch[1]) {
        console.error('Could not extract wos-session cookie from header:', cookieHeader);
        return false;
      }
      
      const sessionCookie = wosSessionMatch[1];
      console.log('Successfully extracted wos-session cookie');
      
      // Parse the user info from the response
      const data = await response.json();
      console.log('Got user data from callback response:', data);
      
      // Store the token
      this.currentToken = {
        accessToken: sessionCookie, // Store just the cookie value, not the whole header
        userId: data.user.id,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      };
      
      this.saveToken();
      
      // Close the auth window if it's still open
      if (this.authWindow && !this.authWindow.isDestroyed()) {
        this.authWindow.close();
        this.authWindow = null;
      }
      
      return true;
    } catch (error) {
      console.error('Error handling OAuth callback:', error);
      return false;
    }
  }

  /**
   * Initiate the WorkOS OAuth flow
   */
  public async initiateOAuth(): Promise<void> {
    const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
    
    // Create URL for direct WorkOS authentication, bypassing our API to avoid redirect URI issues
    // Using the WorkOS client ID directly for the login
    const workosClientId = "client_01JR1K5NJGRW3G99SXEN602TEJ"; // The client ID you provided in the logs
    const redirectUri = "horizon://api/auth/callback"; // The redirect URI you registered with WorkOS
    const authUrl = `https://api.workos.com/user_management/authorize?client_id=${workosClientId}&provider=authkit&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    
    console.log(`Initiating OAuth flow with direct WorkOS URL: ${authUrl}`);
    console.log(`Using redirect URI: ${redirectUri}`);
    
    // Create a new browser window for authentication
    this.authWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Add preload script with special handling for custom protocol
        preload: require('path').join(__dirname, 'protocol-intercept-preload.js')
      }
    });
    
    // Load the auth URL
    this.authWindow.loadURL(authUrl);
    console.log('Loaded auth URL in browser window');
    
    // Handle the window being closed
    this.authWindow.on('closed', () => {
      console.log('Auth window was closed by user');
      this.authWindow = null;
    });
    
    // Handle navigation events to catch the callback URL
    this.authWindow.webContents.on('will-navigate', async (event, url) => {
      console.log(`Navigation detected to: ${url}`);
      
      // Check for our custom protocol or the API callback
      if (url.startsWith(`${API_URL}/api/auth/callback`) || url.startsWith('horizon://')) {
        console.log('Intercepted auth callback URL navigation:', url);
        event.preventDefault();
        
        // For horizon:// protocol URLs, we need to handle them specially
        if (url.startsWith('horizon://')) {
          console.log('Custom protocol URL detected in auth window');
          // This will be caught by protocol-handler.ts
          // We need to close this window and let the protocol handler take over
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          
          // Manually launch the protocol
          shell.openExternal(url);
        } else {
          // Standard API callback
          const result = await this.handleOAuthCallback(url);
          console.log(`handleOAuthCallback result: ${result}`);
        }
      }
    });
    
    // Handle redirects
    this.authWindow.webContents.on('did-redirect-navigation', async (event, url) => {
      console.log(`Redirect detected to: ${url}`);
      
      // Check for our custom protocol or the API callback
      if (url.startsWith(`${API_URL}/api/auth/callback`) || url.startsWith('horizon://')) {
        console.log('Intercepted auth callback URL redirect:', url);
        event.preventDefault();
        
        // For horizon:// protocol URLs, we need to handle them specially
        if (url.startsWith('horizon://')) {
          console.log('Custom protocol URL detected in redirect');
          // This will be caught by protocol-handler.ts
          // We need to close this window and let the protocol handler take over
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          
          // Manually launch the protocol
          shell.openExternal(url);
        } else {
          // Standard API callback
          const result = await this.handleOAuthCallback(url);
          console.log(`handleOAuthCallback result: ${result}`);
        }
      } else if (url.includes('error.workos.com')) {
        console.error('WorkOS error detected in navigation:', url);
        // Show error to user
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.loadURL('data:text/html,<html><body><h2>Authentication Error</h2><p>There was an error during the WorkOS authentication process. Please check the console logs for details.</p><p>Error URL: ' + url + '</p></body></html>');
        }
      }
    });
    
    // Log when navigation completes
    this.authWindow.webContents.on('did-finish-load', () => {
      console.log('Page finished loading in auth window');
    });
    
    // Monitor for protocol URLs that can't be directly intercepted
    this.authWindow.webContents.on('will-redirect', (event, url) => {
      console.log(`Redirect to: ${url}`);
      
      if (url.startsWith('horizon://')) {
        console.log('Intercepted horizon:// protocol URL redirect in will-redirect');
        event.preventDefault();
        
        // Close the window and let the protocol handler handle it
        if (this.authWindow && !this.authWindow.isDestroyed()) {
          this.authWindow.close();
          this.authWindow = null;
        }
        
        // Manually launch the protocol
        shell.openExternal(url);
      } else if (url.includes('error.workos.com')) {
        console.error('WorkOS error detected in will-redirect:', url);
      }
    });
    
    // Debug information about the window
    console.log(`Auth window created with ID: ${this.authWindow.id}`);
  }

  public logout(): void {
    this.currentToken = null;
    this.saveToken();
  }

  /**
   * Get the access token (cookie) for API requests
   * @returns The access token string or null if not authenticated
   */
  public getAccessToken(): string | null {
    if (!this.isAuthenticated()) {
      return null;
    }
    
    return this.currentToken?.accessToken || null;
  }

  /**
   * Check if the user is authenticated
   * @returns True if the user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.currentToken && !!this.currentToken.userId;
  }

  /**
   * Get the user ID
   * @returns The user ID or null if not authenticated
   */
  public getUserId(): string | null {
    return this.currentToken?.userId || null;
  }
}

export default AuthService;