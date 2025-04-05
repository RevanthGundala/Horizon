import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Define the configuration interface
interface AppConfig {
  apiUrl: string;
  environment: string;
  isLoaded: boolean;
}

// Default configuration
const defaultConfig: AppConfig = {
  apiUrl: '',
  environment: 'development',
  isLoaded: false,
};

// Create the context
const ConfigContext = createContext<AppConfig>(defaultConfig);

// Custom hook to use the config
export const useConfig = () => useContext(ConfigContext);

interface ConfigProviderProps {
  children: ReactNode;
}

export const ConfigProvider = ({ children }: ConfigProviderProps) => {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Try to fetch from the backend config endpoint
        // For development, use relative URL which will be proxied by Vite
        const response = await fetch('/config', {
          headers: {
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('Loaded config from API:', data);
          setConfig({
            ...data,
            isLoaded: true,
          });
          return;
        }
        
        console.warn('Failed to load config from API, falling back to env vars');
        // Fallback to environment variables if backend request fails
        setConfig({
          apiUrl: import.meta.env.VITE_API_URL || '',
          environment: import.meta.env.MODE || 'development',
          isLoaded: true,
        });
      } catch (error) {
        console.error('Failed to load configuration:', error);
        // Fallback to environment variables
        setConfig({
          apiUrl: import.meta.env.VITE_API_URL || '',
          environment: import.meta.env.MODE || 'development',
          isLoaded: true,
        });
      }
    };

    loadConfig();
  }, []);

  return (
    <ConfigContext.Provider value={config}>
      {children}
    </ConfigContext.Provider>
  );
};
