import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_TOKEN = 'kun_token';
const STORAGE_KEY_BASE_URL = 'kun_base_url';

export interface ApiError {
  status: number;
  message: string;
}

let onAuthError: (() => void) | null = null;
let onNetworkError: (() => void) | null = null;

export function setAuthErrorCallback(cb: () => void) {
  onAuthError = cb;
}

export function setNetworkErrorCallback(cb: () => void) {
  onNetworkError = cb;
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

function getBaseUrl(): string {
  const state = require('../store/connection').useConnectionStore.getState();
  return state.baseUrl;
}

function getToken(): string {
  const state = require('../store/connection').useConnectionStore.getState();
  return state.token;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getBaseUrl();
  const token = getToken();

  if (!baseUrl || !token) {
    throw { status: 0, message: 'Not configured' } as ApiError;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/mobile${path}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      onAuthError?.();
      throw { status: 401, message: 'Unauthorized – token may be invalid or expired' } as ApiError;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw { status: response.status, message: text || response.statusText } as ApiError;
    }

    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch (err) {
    if ((err as ApiError).status) throw err;
    // Network error
    onNetworkError?.();
    throw { status: 0, message: (err as Error).message || 'Network error' } as ApiError;
  }
}

export async function healthCheck(baseUrl: string): Promise<boolean> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/mobile/health`;
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}
