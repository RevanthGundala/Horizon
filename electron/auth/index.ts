import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { URL } from 'url';
import SyncService from '../database/sync';

// Define the token storage path
const TOKEN_FILE = path.join(app.getPath('userData'), 'auth', 'token.json');

// Define auth types
export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
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
    this.currentToken = this.loadToken();
    console.log("AuthService initialized with token:", this.currentToken);
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

  /**
   * Load the token from persistent storage
   * @returns Loaded token or null if not found or invalid
   */
  private loadToken(): AuthToken | null {
    try {
      // Check if token file exists
      if (!fs.existsSync(TOKEN_FILE)) {
        console.log('Token file does not exist');
        return null;
      }

      // Read encrypted token
      const encryptedToken = fs.readFileSync(TOKEN_FILE, 'utf8');
      
      // Log encrypted token length for debugging
      console.log('Encrypted Token Details:', {
        length: encryptedToken.length,
        firstChars: encryptedToken.slice(0, 20) + '...'
      });

      // Decrypt token
      const decryptedTokenStr = this.decrypt(encryptedToken);
      
      // Parse decrypted token
      const token: AuthToken = JSON.parse(decryptedTokenStr);

      // Validate token structure
      if (!token.accessToken || !token.userId || !token.expiresAt) {
        console.error('Invalid token structure', {
          hasAccessToken: !!token.accessToken,
          hasUserId: !!token.userId,
          hasExpiresAt: !!token.expiresAt
        });
        return null;
      }

      // Log token details for debugging
      console.log('Loaded Token Details:', {
        userId: token.userId,
        expiresAt: token.expiresAt,
        currentTime: Date.now(),
        timeRemaining: token.expiresAt - Date.now()
      });

      return token;
    } catch (error: unknown) {
      console.error('Error loading token:', {
        errorName: error instanceof Error ? error.name : 'Unknown Error',
        errorMessage: error instanceof Error ? error.message : 'Unknown Error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      return null;
    }
  }

  /**
   * Save the current token to persistent storage
   */
  private saveToken(): void {
    try {
      // Ensure the directory exists
      const tokenDir = path.dirname(TOKEN_FILE);
      if (!fs.existsSync(tokenDir)) {
        fs.mkdirSync(tokenDir, { recursive: true });
      }

      // Log token details before saving
      console.log('Saving Token - Details:', {
        hasToken: !!this.currentToken,
        tokenDetails: this.currentToken ? {
          userId: this.currentToken.userId,
          expiresAt: this.currentToken.expiresAt,
          tokenLength: this.currentToken.accessToken.length
        } : null
      });

      // If no token, remove the file
      if (!this.currentToken) {
        if (fs.existsSync(TOKEN_FILE)) {
          fs.unlinkSync(TOKEN_FILE);
          console.log('Token file deleted as no current token exists');
        }
        return;
      }

      // Encrypt the token before saving
      const encryptedToken = this.encrypt(JSON.stringify(this.currentToken));
      
      // Write the encrypted token
      fs.writeFileSync(TOKEN_FILE, encryptedToken, { mode: 0o600 });
      
      console.log('Token saved successfully');
    } catch (error: unknown) {
      console.error('Error saving token:', {
        errorName: error instanceof Error ? error.name : 'Unknown Error',
        errorMessage: error instanceof Error ? error.message : 'Unknown Error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
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
      const sessionFromUrl = url.searchParams.get('session');
      
      // For direct WorkOS auth with code (most common flow)
      if (url.protocol === 'horizon:' && code) {
        console.log('Direct WorkOS callback detected with code:', code);
        
        try {
          // Exchange the code for a session via our backend API
          const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
          
          console.log(`Calling API for code exchange: ${API_URL}/api/auth/callback`);
          const response = await fetch(`${API_URL}/api/auth/callback?code=${code}&redirect_uri=${encodeURIComponent("horizon://api/auth/callback")}&electron=true`, {
            method: 'GET',
            headers: {
              'X-Electron-App': 'true',
              'Origin': 'electron://horizon',
              'Accept': 'application/json',
            }
          });
          
          if (!response.ok) {
            console.error(`Error exchanging code: ${response.status} ${response.statusText}`);
            return false;
          }
          
          try {
            // Parse the response to get user data and session
            const responseData = await response.json();
            console.log('Received response:', JSON.stringify({
              hasUserId: !!responseData.userId,
              hasSealedSession: !!responseData.sealedSession
            }));
            
            if (!responseData.userId || !responseData.sealedSession) {
              console.error('Response missing required data');
              return false;
            }
            
            // Store the token
            this.currentToken = {
              accessToken: responseData.sealedSession,
              userId: responseData.userId,
              expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            };
            
            this.saveToken();
            console.log(`Successfully stored authentication for user ${responseData.userId}`);

            // Pull changes after creating user
            await SyncService.getInstance().syncWithServer();
            
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
             // mainWindow.webContents.send('auth:status-changed', true);
             mainWindow.webContents.send('auth-success', this.currentToken.userId);
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
          } catch (parseError: unknown) {
            console.error('Error parsing API response:', {
              errorName: parseError instanceof Error ? parseError.name : 'Unknown Error',
              errorMessage: parseError instanceof Error ? parseError.message : 'Unknown Error',
              errorStack: parseError instanceof Error ? parseError.stack : 'No stack trace'
            });
            return false;
          }
        } catch (error: unknown) {
          console.error('Error in code exchange:', {
            errorName: error instanceof Error ? error.name : 'Unknown Error',
            errorMessage: error instanceof Error ? error.message : 'Unknown Error',
            errorStack: error instanceof Error ? error.stack : 'No stack trace'
          });
          return false;
        }
      }
      
      // Handle session directly provided in URL (alternative flow)
      if (sessionFromUrl) {
        console.log('Session provided directly in URL');
        try {
          // Verify the session with the backend
          const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
          
          // Try to get user info with this session
          const meResponse = await fetch(`${API_URL}/api/auth/me`, {
            method: 'GET',
            headers: {
              'Cookie': `wos-session=${sessionFromUrl}`,
              'Authorization': `Bearer ${sessionFromUrl}`,
              'X-Electron-App': 'true'
            },
            credentials: 'include',
          });
          
          if (!meResponse.ok) {
            console.error('Error validating session:', meResponse.status);
            return false;
          }
          
          const userData = await meResponse.json();
          if (!userData.userId) {
            console.error('No user ID returned from session validation');
            return false;
          }
          
          // Store the validated session
          this.currentToken = {
            accessToken: sessionFromUrl,
            userId: userData.userId,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
          };
          
          this.saveToken();
          console.log(`Successfully validated and stored session for user ${userData.userId}`);
          
          // Close the auth window if it's still open
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          
          // Notify about successful authentication
          const { BrowserWindow } = require('electron');
          const mainWindow = BrowserWindow.getAllWindows().find((w: any) => true);
          if (mainWindow) {
            mainWindow.webContents.send('auth-success', this.currentToken.userId);
          }
          
          return true;
        } catch (error: unknown) {
          console.error('Error validating session from URL:', {
            errorName: error instanceof Error ? error.name : 'Unknown Error',
            errorMessage: error instanceof Error ? error.message : 'Unknown Error',
            errorStack: error instanceof Error ? error.stack : 'No stack trace'
          });
          return false;
        }
      }
      
      // If we get here, we couldn't authenticate
      console.error('No valid authentication data found in callback URL');
      return false;
    } catch (error: unknown) {
      console.error('Error handling OAuth callback:', {
        errorName: error instanceof Error ? error.name : 'Unknown Error',
        errorMessage: error instanceof Error ? error.message : 'Unknown Error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      return false;
    }
  }

  /**
   * Initiate the WorkOS OAuth flow
   */
  public async initiateOAuth(): Promise<void> {
    const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
    
    try {
      // First clear any existing auth state to ensure a clean login flow
      this.logout();
      
      // Use our backend endpoint to initiate the OAuth flow
      // This ensures the server and client are using the same configuration
      const loginUrl = `${API_URL}/api/auth/login?redirect_uri=${encodeURIComponent("horizon://api/auth/callback")}&electron=true`;
      const loginResponse = await fetch(loginUrl);
      
      if (!loginResponse.ok) {
        console.error(`Error initiating OAuth flow: ${loginResponse.status} ${loginResponse.statusText}`);
        throw new Error(`Failed to initiate OAuth flow: ${loginResponse.status}`);
      }
      
      // The login endpoint returns a redirect URL to WorkOS
      const authUrl = loginResponse.headers.get('Location');
      if (!authUrl) {
        throw new Error('No authorization URL returned from login endpoint');
      }
      
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
    } catch (error: unknown) {
      console.error('Error initiating OAuth flow:', {
        errorName: error instanceof Error ? error.name : 'Unknown Error',
        errorMessage: error instanceof Error ? error.message : 'Unknown Error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      
      // Fallback to direct WorkOS authentication if our API fails
      console.log('Falling back to direct WorkOS authentication');
      const workosClientId = "client_01JR1K5NJGRW3G99SXEN602TEJ";
      const redirectUri = "horizon://api/auth/callback"; 
      const fallbackAuthUrl = `https://api.workos.com/user_management/authorize?client_id=${workosClientId}&provider=authkit&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
      
      // Create a new browser window for authentication if not already created
      if (!this.authWindow || this.authWindow.isDestroyed()) {
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
      }
      
      // Load the auth URL
      this.authWindow.loadURL(fallbackAuthUrl);
    }
    
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
    console.log('Electron Auth Service: Logging out, clearing all auth state');
    this.currentToken = null;
    this.saveToken();
    
    // Also explicitly delete the token file
    if (fs.existsSync(TOKEN_FILE)) {
      try {
        fs.unlinkSync(TOKEN_FILE);
        console.log('Electron Auth Service: Token file deleted successfully');
      } catch (error: unknown) {
        console.error('Failed to delete token file:', {
          errorName: error instanceof Error ? error.name : 'Unknown Error',
          errorMessage: error instanceof Error ? error.message : 'Unknown Error',
          errorStack: error instanceof Error ? error.stack : 'No stack trace'
        });
      }
    }
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
    // Log the entire current token state for debugging
    console.log('Authentication Check - Current Token:', {
      exists: !!this.currentToken,
      tokenDetails: this.currentToken ? {
        userId: this.currentToken.userId,
        expiresAt: this.currentToken.expiresAt,
        currentTime: Date.now(),
        timeRemaining: this.currentToken.expiresAt - Date.now()
      } : null
    });

    // Check if token exists
    if (!this.currentToken) {
      console.log('Authentication check failed: No current token');
      return false;
    }

    // Check if token is expired
    const isExpired = Date.now() > this.currentToken.expiresAt;
    if (isExpired) {
      console.log('Authentication check failed: Token expired', {
        currentTime: Date.now(),
        expiresAt: this.currentToken.expiresAt
      });
      return false;
    }

    // Check if userId exists
    if (!this.currentToken.userId) {
      console.log('Authentication check failed: No user ID in token');
      return false;
    }

    console.log('Authentication check passed');
    return true;
  }

  /**
   * Get the user ID
   * @returns The user ID or null if not authenticated
   */
  public getUserId(): string | null {
    return this.currentToken?.userId || null;
  }

  // Public method to get token details for debugging
  public getTokenDetails(): { 
    isAuthenticated: boolean, 
    userId: string | null, 
    expiresAt: number | null, 
    isExpired: boolean 
  } {
    return {
      isAuthenticated: this.isAuthenticated(),
      userId: this.currentToken?.userId ?? null,
      expiresAt: this.currentToken?.expiresAt ?? null,
      isExpired: this.currentToken ? Date.now() > this.currentToken.expiresAt : true
    };
  }

  /**
   * Validate and potentially refresh the current authentication token
   * @returns Promise<boolean> indicating if the token is valid or was successfully refreshed
   */
  public async validateToken(): Promise<boolean> {
    // Check if token exists
    if (!this.currentToken) {
      console.log('No token exists');
      return false;
    }

    // Check if token is expired
    const isExpired = Date.now() > this.currentToken.expiresAt;
    if (isExpired) {
      try {
        // Attempt to refresh the token
        const refreshedToken = await this.refreshToken();
        return !!refreshedToken;
      } catch (error: unknown) {
        console.error('Token refresh failed:', {
          errorName: error instanceof Error ? error.name : 'Unknown Error',
          errorMessage: error instanceof Error ? error.message : 'Unknown Error',
          errorStack: error instanceof Error ? error.stack : 'No stack trace'
        });
        return false;
      }
    }

    // Token is valid
    return true;
  }

  /**
   * Refresh the current authentication token
   * @returns Promise<boolean> indicating if token refresh was successful
   */
  private async refreshToken(): Promise<boolean> {
    // Explicit null check before attempting refresh
    if (!this.currentToken) {
      console.error('Cannot refresh token: No current token exists');
      return false;
    }

    try {
      // Use environment variable with fallback, ensuring a valid URL
      const apiUrl = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';
      
      // Validate the token before refresh attempt
      if (!this.currentToken.accessToken) {
        console.error('Cannot refresh token: No access token present');
        return false;
      }

      const response = await fetch(`${apiUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentToken.accessToken}`
        },
        body: JSON.stringify({
          // Include any additional refresh token details if needed
          userId: this.currentToken.userId
        })
      });

      // Detailed error handling for non-successful responses
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Token refresh failed. Status: ${response.status}, Body: ${errorBody}`);
        throw new Error(`Token refresh failed with status ${response.status}`);
      }

      const newTokenData = await response.json();
      
      // Validate the new token data
      if (!newTokenData.sealedSession || !newTokenData.userId) {
        console.error('Invalid token data received during refresh');
        return false;
      }

      // Update the current token with new data
      this.currentToken = {
        accessToken: newTokenData.sealedSession,
        userId: newTokenData.userId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
      };

      // Save the new token
      this.saveToken();

      console.log('Token refreshed successfully');
      return true;
    } catch (error: unknown) {
      console.error('Comprehensive token refresh error:', {
        errorName: error instanceof Error ? error.name : 'Unknown Error',
        errorMessage: error instanceof Error ? error.message : 'Unknown Error',
        errorStack: error instanceof Error ? error.stack : 'No stack trace'
      });
      
      // Clear the current token on persistent failures
      this.currentToken = null;
      this.saveToken(); // Persist the null token state
      
      return false;
    }
  }

  /**
   * Check if the current token needs refreshing
   * @returns Promise<boolean> indicating if a refresh is needed
   */
  public async needsTokenRefresh(): Promise<boolean> {
    if (!this.currentToken) {
      return true;
    }

    // Check if token is close to expiration (within 1 hour)
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    return this.currentToken.expiresAt <= oneHourFromNow;
  }
}

export default AuthService;