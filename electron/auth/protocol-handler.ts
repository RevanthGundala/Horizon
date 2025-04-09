import { app } from 'electron';
import AuthService from './index';

/**
 * Set up custom protocol handler for OAuth callback
 * This allows the app to intercept custom URLs like horizon://auth/callback
 */
export function setupProtocolHandler(): void {
  // Register the custom protocol
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('horizon', process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient('horizon');
  }

  // Handle the protocol. In this case, we choose to handle the protocol
  // in the main process, but you could also handle it in a renderer process
  // by sending the URL to the renderer via IPC.
  app.on('open-url', async (event, url) => {
    event.preventDefault();
    
    // Handle the URL
    if (url.startsWith('horizon://api/auth/callback')) {
      const auth = AuthService.getInstance();
      await auth.handleOAuthCallback(url);
    }
  });

  // Handle protocol for Windows
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    const url = commandLine.pop();
    if (url && url.startsWith('horizon://api/auth/callback')) {
      const auth = AuthService.getInstance();
      auth.handleOAuthCallback(url);
    }
  });
}