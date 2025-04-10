import { app } from 'electron';
import AuthService from './index';

/**
 * Set up custom protocol handler for OAuth callback
 * This allows the app to intercept custom URLs like horizon://auth/callback
 */
export function setupProtocolHandler(): void {
  console.log('Setting up protocol handler for horizon:// URLs');
  
  // Force protocol handler deregistration first to ensure clean state
  app.removeAsDefaultProtocolClient('horizon');
  
  // Register the custom protocol
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      const registered = app.setAsDefaultProtocolClient('horizon', process.execPath, [process.argv[1]]);
      console.log(`Registered protocol handler in dev mode: ${registered}`);
    }
  } else {
    const registered = app.setAsDefaultProtocolClient('horizon');
    console.log(`Registered protocol handler in production mode: ${registered}`);
  }

  // This handles macOS when app is already running
  app.on('open-url', async (event, url) => {
    console.log(`Received open-url event with URL: ${url}`);
    event.preventDefault();
    
    // Handle the URL
    if (url.startsWith('horizon://api/auth/callback')) {
      console.log('Processing horizon:// auth callback URL in open-url handler');
      try {
        const auth = AuthService.getInstance();
        const result = await auth.handleOAuthCallback(url);
        console.log(`handleOAuthCallback result: ${result}`);
      } catch (error) {
        console.error('Error handling OAuth callback in open-url handler:', error);
      }
    } else {
      console.log(`Ignoring non-auth URL: ${url}`);
    }
  });

  // This is called on app launch from a URL on macOS/Windows
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    console.log('Another instance is already running, quitting');
    app.quit();
  } else {
    // Primary instance - set up handler
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      console.log('Second instance detected, processing arguments:', commandLine);
      
      // Find URL in command line args
      let urlFound = false;
      for (const arg of commandLine) {
        if (arg.startsWith('horizon://')) {
          urlFound = true;
          console.log('Processing auth callback URL from second instance:', arg);
          try {
            const auth = AuthService.getInstance();
            auth.handleOAuthCallback(arg);
          } catch (error) {
            console.error('Error handling OAuth callback in second-instance handler:', error);
          }
          break;
        }
      }
      
      if (!urlFound) {
        console.log('No horizon:// URL found in commandLine:', commandLine);
      }
      
      // Focus the main window if it exists
      const windows = require('electron').BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const mainWindow = windows[0];
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
  
  // Handle command line arguments at startup (primarily for Windows)
  const argv = process.argv;
  console.log('Checking command line arguments for protocol URLs:', argv);
  let protocolUrlFound = false;
  
  for (const arg of argv) {
    if (arg.startsWith('horizon://')) {
      protocolUrlFound = true;
      console.log('Found deeplink URL in initial launch arguments:', arg);
      
      // Give the app time to initialize fully before handling the URL
      setTimeout(() => {
        try {
          const auth = AuthService.getInstance();
          const result = auth.handleOAuthCallback(arg);
          console.log(`handleOAuthCallback result from startup args: ${result}`);
        } catch (error) {
          console.error('Error handling OAuth callback from startup args:', error);
        }
      }, 1000);
      
      break;
    }
  }
  
  if (!protocolUrlFound) {
    console.log('No horizon:// URL found in startup arguments');
  }
  
  // Log protocol client status
  console.log(`Is horizon registered as default protocol client: ${app.isDefaultProtocolClient('horizon')}`);
}