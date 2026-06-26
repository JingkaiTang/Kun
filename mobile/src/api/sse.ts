import { AppState, AppStateStatus } from 'react-native';
import type { SSEEvent } from '../types/api';

type SSEHandler = (event: SSEEvent) => void;
type StatusHandler = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

export class SSEClient {
  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private baseDelay = 1000;
  private maxDelay = 30000;
  private currentDelay = 1000;
  private appStateSubscription: any = null;
  private isManuallyDisconnected = false;
  private baseUrl = '';
  private token = '';
  private threadId = '';

  private onEvent: SSEHandler = () => {};
  private onStatus: StatusHandler = () => {};

  connect(
    baseUrl: string,
    token: string,
    threadId: string,
    onEvent: SSEHandler,
    onStatus: StatusHandler,
  ) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.threadId = threadId;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.isManuallyDisconnected = false;
    this.currentDelay = this.baseDelay;

    this.connectInternal();

    // Listen for app state changes
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppState);
  }

  disconnect() {
    this.isManuallyDisconnected = true;
    this.cleanup();
  }

  private cleanup() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  private handleAppState = (state: AppStateStatus) => {
    if (state === 'active' && !this.isManuallyDisconnected) {
      // Reconnect when app comes to foreground
      if (!this.controller) {
        this.onStatus('reconnecting');
        this.connectInternal();
      }
    }
  };

  private async connectInternal() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }

    this.controller = new AbortController();
    const url = `${this.baseUrl.replace(/\/+$/, '')}/mobile/v1/threads/${this.threadId}/events`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'text/event-stream',
        },
        signal: this.controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.onStatus('disconnected');
          return; // Don't reconnect on auth errors
        }
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      this.currentDelay = this.baseDelay;
      this.onStatus('connected');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No readable stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent: string | null = null;
        let currentData: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData.push(line.slice(6));
          } else if (line === '' && currentEvent) {
            // End of event
            const dataStr = currentData.join('\n');
            try {
              const data = JSON.parse(dataStr);
              this.onEvent({
                kind: currentEvent,
                data,
                threadId: this.threadId,
              });
            } catch {
              // Non-JSON data
              this.onEvent({
                kind: currentEvent,
                data: dataStr,
                threadId: this.threadId,
              });
            }
            currentEvent = null;
            currentData = [];
          }
        }
      }

      // Stream ended cleanly
      if (!this.isManuallyDisconnected) {
        this.scheduleReconnect();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!this.isManuallyDisconnected) {
        this.onStatus('reconnecting');
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.isManuallyDisconnected) return;

    this.reconnectTimer = setTimeout(() => {
      this.connectInternal();
    }, this.currentDelay);

    // Exponential backoff
    this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
  }
}
