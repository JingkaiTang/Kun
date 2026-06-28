import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_TOKEN = 'kun_token';
const STORAGE_KEY_BASE_URL = 'kun_base_url';

/**
 * Auth/network error callbacks. Wired by the connection store so the
 * UI can react to gateway-wide failures. The KunRuntimeClient calls
 * these directly when an HTTP call returns 401 or fails to connect;
 * the old `apiFetch` wrapper is gone.
 */
let onAuthError: (() => void) | null = null;
let onNetworkError: (() => void) | null = null;

export function setAuthErrorCallback(cb: () => void) {
  onAuthError = cb;
}

export function setNetworkErrorCallback(cb: () => void) {
  onNetworkError = cb;
}

export function notifyAuthError(): void {
  onAuthError?.();
}

export function notifyNetworkError(): void {
  onNetworkError?.();
}

export async function loadCredentials(): Promise<{ baseUrl: string; token: string } | null> {
  try {
    const [baseUrl, token] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_BASE_URL),
      AsyncStorage.getItem(STORAGE_KEY_TOKEN),
    ]);
    if (baseUrl && token) return { baseUrl, token };
    return null;
  } catch {
    return null;
  }
}

export async function saveCredentials(baseUrl: string, token: string): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEY_BASE_URL, baseUrl),
    AsyncStorage.setItem(STORAGE_KEY_TOKEN, token),
  ]);
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(STORAGE_KEY_BASE_URL),
    AsyncStorage.removeItem(STORAGE_KEY_TOKEN),
  ]);
}

export async function healthCheck(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/mobile/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, error: `Server returned ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { ok: false, error: message };
  }
}
