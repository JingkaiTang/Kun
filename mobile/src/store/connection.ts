import { create } from 'zustand';
import { healthCheck, loadCredentials, saveCredentials, clearCredentials, setAuthErrorCallback, setNetworkErrorCallback } from '../api/client';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface ConnectionState {
  baseUrl: string;
  token: string;
  status: ConnectionStatus;
  error: string | null;

  // Actions
  connect: (baseUrl: string, token: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  setStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  loadSaved: () => Promise<boolean>;
  setAuthError: () => void;
  setNetworkError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  baseUrl: '',
  token: '',
  status: 'disconnected',
  error: null,

  connect: async (baseUrl: string, token: string) => {
    set({ status: 'connecting', error: null });

    // Quick health check (no auth needed)
    const result = await healthCheck(baseUrl);
    if (!result.ok) {
      set({ status: 'disconnected', error: `Cannot reach the gateway: ${result.error || 'unknown error'}` });
      return false;
    }

    await saveCredentials(baseUrl, token);
    set({ baseUrl, token, status: 'connected', error: null });
    return true;
  },

  disconnect: async () => {
    await clearCredentials();
    set({ baseUrl: '', token: '', status: 'disconnected', error: null });
  },

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),

  loadSaved: async () => {
    const creds = await loadCredentials();
    if (creds) {
      // Try to auto-connect
      set({ baseUrl: creds.baseUrl, token: creds.token, status: 'connecting' });
      const result = await healthCheck(creds.baseUrl);
      if (result.ok) {
        set({ status: 'connected' });
        return true;
      } else {
        set({ status: 'disconnected', error: 'Previously saved gateway is not reachable' });
        return false;
      }
    }
    return false;
  },

  setAuthError: () => {
    set({ status: 'disconnected', error: 'Authentication failed. Please check your token.' });
  },

  setNetworkError: () => {
    const { status } = get();
    if (status === 'connected') {
      set({ status: 'reconnecting', error: 'Connection lost' });
    }
  },
}));

// Wire up global error callbacks
setAuthErrorCallback(() => {
  useConnectionStore.getState().setAuthError();
});

setNetworkErrorCallback(() => {
  useConnectionStore.getState().setNetworkError();
});
