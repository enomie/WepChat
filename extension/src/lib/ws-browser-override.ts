/**
 * Browser-safe override for spacetimedb/src/sdk/ws.ts
 *
 * Chrome Extension CSP forbids `unsafe-eval`. The original ws.ts uses:
 *   new Function('m', 'return import(m)')
 * as a trick to do a lazy dynamic import in Node environments.
 *
 * In the browser (and Chrome extensions), `WebSocket` is always globally
 * available, so the Node.js fallback path is dead code.
 * This file replaces the entire ws.ts module with a CSP-compliant version.
 */

export interface WebSocketAdapter {
  readonly protocol: string;
  readonly readyState?: number;
  send(msg: Uint8Array<ArrayBuffer>): void;
  close(): void;

  set onclose(handler: (ev: CloseEvent) => void);
  set onopen(handler: () => void);
  set onmessage(handler: (msg: { data: Uint8Array }) => void);
  set onerror(handler: (msg: ErrorEvent) => void);
}

export class WebSocketTokenError extends Error {
  constructor(
    readonly status: number,
    statusText: string
  ) {
    super(`Failed to verify token: ${status} ${statusText}`);
    this.name = 'WebSocketTokenError';
  }
}

export interface WebSocketArgs {
  url: URL;
  wsProtocol: string[];
  nameOrAddress: string;
  authToken?: string;
  compression: 'gzip' | 'brotli' | 'none';
  lightMode: boolean;
  confirmedReads?: boolean;
  connectionId?: string;
  sessionId?: string;
}

export type WebSocketFactory = (args: WebSocketArgs) => Promise<WebSocketAdapter>;

export async function openWebSocket({
  url,
  nameOrAddress,
  wsProtocol,
  authToken,
  compression,
  lightMode,
  confirmedReads,
  connectionId,
  sessionId,
}: WebSocketArgs): Promise<WebSocket> {
  const headers = new Headers();

  // Browser always has WebSocket globally. No dynamic import / new Function needed.
  const WS = WebSocket;

  let temporaryAuthToken: string | undefined;
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
    const tokenUrl = new URL('v1/identity/websocket-token', url);
    tokenUrl.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';

    const response = await fetch(tokenUrl, { method: 'POST', headers });
    if (response.ok) {
      const { token } = await response.json();
      temporaryAuthToken = token;
    } else {
      throw new WebSocketTokenError(response.status, response.statusText);
    }
  }

  const databaseUrl = new URL(`v1/database/${nameOrAddress}/subscribe`, url);
  if (temporaryAuthToken) {
    databaseUrl.searchParams.set('token', temporaryAuthToken);
  }
  databaseUrl.searchParams.set(
    'compression',
    { gzip: 'Gzip', brotli: 'Brotli', none: 'None' }[compression] ?? 'None'
  );
  if (lightMode) {
    databaseUrl.searchParams.set('light', 'true');
  }
  if (confirmedReads !== undefined) {
    databaseUrl.searchParams.set('confirmed', confirmedReads.toString());
  }
  if (connectionId) {
    databaseUrl.searchParams.set('connection_id', connectionId);
  }
  if (sessionId) {
    databaseUrl.searchParams.set('session_id', sessionId);
  }

  const ws = new WS(databaseUrl.toString(), wsProtocol);
  ws.binaryType = 'arraybuffer';
  return ws;
}
