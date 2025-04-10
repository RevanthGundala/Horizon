// This preload script helps intercept horizon:// URLs in the auth window
// It's specifically designed to run in the WorkOS authentication window

const { contextBridge, ipcRenderer } = require('electron');

// Insert a MutationObserver to watch for navigation events
window.addEventListener('DOMContentLoaded', () => {
  console.log('Protocol intercept preload script running');
  
  // Watch for any attempts to navigate to custom protocol
  document.addEventListener('click', (event) => {
    // If clicking a link
    if (event.target.tagName === 'A' || 
        (event.target.parentElement && event.target.parentElement.tagName === 'A')) {
      
      const link = event.target.tagName === 'A' ? event.target : event.target.parentElement;
      const href = link.getAttribute('href');
      
      if (href && href.startsWith('horizon://')) {
        console.log('Intercepted click on horizon:// link:', href);
        event.preventDefault();
        
        // Tell the main process about this URL
        ipcRenderer.send('protocol-detected', href);
        
        // Show a message to the user
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.top = '50%';
        div.style.left = '50%';
        div.style.transform = 'translate(-50%, -50%)';
        div.style.padding = '20px';
        div.style.background = '#fff';
        div.style.border = '1px solid #ccc';
        div.style.borderRadius = '5px';
        div.style.zIndex = '9999';
        div.textContent = 'Redirecting to the Horizon app...';
        document.body.appendChild(div);
        
        return false;
      }
    }
  });
  
  // Watch for meta refresh or other redirects
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const links = document.querySelectorAll('meta[http-equiv="refresh"]');
        for (const link of links) {
          const content = link.getAttribute('content');
          if (content && content.includes('horizon://')) {
            const match = content.match(/URL=([^;]+)/i);
            if (match && match[1].startsWith('horizon://')) {
              console.log('Intercepted meta refresh to horizon:// URL:', match[1]);
              ipcRenderer.send('protocol-detected', match[1]);
            }
          }
        }
      }
    }
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
});

// Listen for protocol URIs in navigation events
window.addEventListener('beforeunload', (event) => {
  try {
    const url = window.location.href;
    if (url.startsWith('horizon://')) {
      console.log('Detected navigation to horizon:// URL:', url);
      ipcRenderer.send('protocol-detected', url);
      event.preventDefault();
    }
  } catch (error) {
    console.error('Error in beforeunload handler:', error);
  }
});