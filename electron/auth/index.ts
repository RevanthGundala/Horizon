import { app, BrowserWindow } from 'electron';
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
   */
  public async handleOAuthCallback(callbackUrl: string): Promise<boolean> {
    try {
      // Parse the URL to get the code and state parameters
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      if (!code) {
        console.error('No code parameter in callback URL');
        return false;
      }

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
      const cookies = response.headers.get('set-cookie');
      if (!cookies) {
        console.error('No cookies in response');
        return false;
      }
      
      // Parse the user info from the response
      const data = await response.json();
      
      // Store the token
      this.currentToken = {
        accessToken: cookies, // Store the cookie as the access token
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
    const authUrl = `${API_URL}/api/auth/login`;
    
    // Create a new browser window for authentication
    this.authWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Load the auth URL
    this.authWindow.loadURL(authUrl);
    
    // Handle the window being closed
    this.authWindow.on('closed', () => {
      this.authWindow = null;
    });
    
    // Handle navigation events to catch the callback URL
    this.authWindow.webContents.on('will-navigate', async (event, url) => {
      if (url.startsWith(`${API_URL}/api/auth/callback`)) {
        event.preventDefault();
        await this.handleOAuthCallback(url);
      }
    });
    
    // Also handle redirects
    this.authWindow.webContents.on('did-redirect-navigation', async (event, url) => {
      if (url.startsWith(`${API_URL}/api/auth/callback`)) {
        event.preventDefault();
        await this.handleOAuthCallback(url);
      }
    });
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