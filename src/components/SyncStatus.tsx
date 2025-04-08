import React, { useEffect, useState } from 'react';
import { useNetworkStatus, useSync } from '../hooks/usePages';
import { dbSync } from '../utils/db';

const SyncStatus: React.FC = () => {
  const { data: networkStatus, isLoading: isNetworkStatusLoading } = useNetworkStatus();
  const syncMutation = useSync();
  const [pendingChanges, setPendingChanges] = useState(0);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  // Check for pending changes periodically
  useEffect(() => {
    const checkPendingChanges = async () => {
      const count = await dbSync.getPendingChangesCount();
      setPendingChanges(count);
    };

    // Check immediately
    checkPendingChanges();

    // Then check every 5 seconds
    const interval = setInterval(checkPendingChanges, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle manual sync
  const handleSync = async () => {
    if (networkStatus?.isOnline) {
      try {
        await syncMutation.mutateAsync();
        setLastSynced(new Date());
      } catch (error) {
        console.error('Sync failed:', error);
      }
    }
  };

  // Setup network detection
  useEffect(() => {
    const setupNetworkListeners = () => {
      const updateNetworkStatus = async () => {
        await dbSync.setOnlineStatus(navigator.onLine);
      };

      window.addEventListener('online', updateNetworkStatus);
      window.addEventListener('offline', updateNetworkStatus);

      // Initial check
      updateNetworkStatus();

      return () => {
        window.removeEventListener('online', updateNetworkStatus);
        window.removeEventListener('offline', updateNetworkStatus);
      };
    };

    return setupNetworkListeners();
  }, []);

  if (isNetworkStatusLoading) {
    return <div className="sync-status loading">Loading...</div>;
  }

  return (
    <div className={`sync-status ${networkStatus?.isOnline ? 'online' : 'offline'}`}>
      <div className="sync-status-indicator">
        <span className={`status-dot ${networkStatus?.isOnline ? 'online' : 'offline'}`} />
        <span className="status-text">
          {networkStatus?.isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      
      {pendingChanges > 0 && (
        <div className="pending-changes">
          {pendingChanges} change{pendingChanges !== 1 ? 's' : ''} pending
        </div>
      )}
      
      {networkStatus?.isOnline && (
        <button 
          className="sync-button" 
          onClick={handleSync}
          disabled={syncMutation.isPending || pendingChanges === 0}
        >
          {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
      )}
      
      {lastSynced && (
        <div className="last-synced">
          Last synced: {lastSynced.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

export default SyncStatus;
