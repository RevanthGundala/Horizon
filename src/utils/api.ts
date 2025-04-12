// Helper function for API URL (kept for backward compatibility)
export function getUrl(endpoint: string) {
  return `${import.meta.env.VITE_API_URL}${endpoint}`;
}

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  // Check if we have an access token
  let accessToken = null;
  
  // For Electron, get the token from the main process
  if (window.electron) {
    try {
      const isAuthenticated = await window.electron.ipcRenderer.invoke('auth:is-authenticated');
      console.log(`API: Authentication check with Electron: ${isAuthenticated}`);
      
      if (isAuthenticated) {
        accessToken = await window.electron.ipcRenderer.invoke('auth:get-access-token');
        console.log(`API: Got access token from Electron: ${accessToken ? 'present' : 'missing'}`);
      }
    } catch (error) {
      console.error('Error getting access token from Electron:', error);
    }
  }
  
  // Set up headers with authentication if available
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  
  if (accessToken) {
    console.log(`API: Adding Authorization header with token`);
    headers.set('Authorization', `Bearer ${accessToken}`);
    
    // Also set X-Electron-App header to indicate this is coming from Electron
    headers.set('X-Electron-App', 'true');
  }
  
  // Include credentials for cookies
  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };
  
  // Capture start time for debugging
  const startTime = Date.now();
  console.log(`API: Fetching ${url} at ${new Date().toISOString()}`);
  
  try {
    // Make the request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    fetchOptions.signal = controller.signal;
    const response = await fetch(getUrl(url), fetchOptions);
    clearTimeout(timeoutId);
    
    const endTime = Date.now();
    console.log(`API: Received response for ${url} with status ${response.status} in ${endTime - startTime}ms`);
    
    // Handle authentication errors
    if (response.status === 401 || response.status === 302) {
      // For 302 Found, we need to check if it's an auth redirect
      if (response.status === 302) {
        const locationHeader = response.headers.get('Location');
        console.log(`API: Received redirect to ${locationHeader}`);
        
        if (locationHeader && (locationHeader.includes('/login') || locationHeader.includes('auth'))) {
          // This is an auth redirect, handle it similarly to a 401
          console.log(`API: Authentication redirect detected`);
          return { error: 'Authentication required', status: response.status, location: locationHeader };
        }
      }
      
      console.log(`API: Authentication error (${response.status})`);
      return { error: 'Authentication required', status: response.status };
    }
    
    return response;
  } catch (error) {
    console.error(`API: Fetch error for ${url}:`, error);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Request timeout', status: 408 };
    }
    
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}