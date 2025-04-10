/**
 * This file contains utility functions for making API requests from the Electron main process.
 * It ensures proper authentication is included with each request.
 */

import AuthService from './auth';

/**
 * Make an authenticated API request.
 * This function automatically includes the authentication cookie in the request headers.
 * 
 * @param url The URL to request
 * @param options Request options (same as fetch API)
 * @returns The fetch response
 */
export async function fetchWithAuth(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  const auth = AuthService.getInstance();
  const sessionCookie = auth.getAccessToken();
  
  // Set up headers with authentication
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  
  // Add authentication cookie if available
  if (sessionCookie) {
    headers.set('Cookie', `wos-session=${sessionCookie}`);
  }
  
  // Create final request options
  const requestOptions: RequestInit = {
    ...options,
    headers
  };
  
  // Make the request
  return fetch(url, requestOptions);
}