/**
 * SpacetimeDB connection state für WepChat.
 * Vereinfacht: kein Race-Condition-Loop, kein overengineering.
 */
import { DbConnection } from './spacetimedb';
import type { ChatMessage } from './spacetimedb/types';

const SPACETIMEDB_URI = 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = 'wepchat';

export interface ChatState {
  connected: boolean;
  onlineCount: number;
  messages: ChatMessage[];
  identity: string | null;
  error: string | null;
}

function createSpacetimeChat() {
  let conn: DbConnection | null = null;
  let subscribedUrl = '';

  let state = $state<ChatState>({
    connected: false,
    onlineCount: 0,
    messages: [],
    identity: null,
    error: null,
  });

  function connect() {
    if (conn) return; // bereits verbunden oder verbindet

    console.log('[WepChat] Starte Verbindung zu SpacetimeDB...');

    try {
      conn = DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withDatabaseName(MODULE_NAME)
        .onConnect((_connection, identity, _token) => {
          console.log('[WepChat] Verbunden! Identity:', identity.toHexString());
          state.connected = true;
          state.identity = identity.toHexString();
          state.error = null;
        })
        .onDisconnect((_connection, _error) => {
          console.warn('[WepChat] Getrennt.');
          state.connected = false;
        })
        .onConnectError((_ctx, err) => {
          console.error('[WepChat] Verbindungsfehler:', err);
          state.connected = false;
          state.error = String(err);
        })
        .build();

      // Table Callbacks registrieren
      conn.db.chat_message.onInsert((_ctx, row) => {
        if (row.url === subscribedUrl) {
          const exists = state.messages.some((m) => m.id === row.id);
          if (!exists) {
            state.messages = [...state.messages, row].sort(
              (a, b) => Number(a.id) - Number(b.id)
            );
          }
        }
      });

      conn.db.user_session.onInsert(recountOnline);
      conn.db.user_session.onUpdate(recountOnline);
      conn.db.user_session.onDelete(recountOnline);
    } catch (err) {
      console.error('[WepChat] Build-Fehler:', err);
      state.error = String(err);
    }
  }

  function recountOnline() {
    if (!conn || !subscribedUrl) return;
    let count = 0;
    for (const session of conn.db.user_session.iter()) {
      if (session.currentUrl === subscribedUrl) count++;
    }
    state.onlineCount = count;
  }

  function subscribeToUrl(url: string, username: string) {
    if (!conn || !state.connected) return; // warten bis connected

    if (subscribedUrl === url) return; // bereits abonniert
    subscribedUrl = url;
    state.messages = [];
    state.onlineCount = 0;

    conn
      .subscriptionBuilder()
      .onApplied((_ctx) => {
        // Initial-Daten laden
        if (!conn) return;
        const msgs: ChatMessage[] = [];
        for (const msg of conn.db.chat_message.iter()) {
          if (msg.url === url) msgs.push(msg);
        }
        state.messages = msgs.sort((a, b) => Number(a.id) - Number(b.id));
        recountOnline();
      })
      .subscribe([
        `SELECT * FROM chat_message WHERE url = '${url}'`,
        `SELECT * FROM user_session WHERE current_url = '${url}'`,
      ]);

    try {
      conn.reducers.joinRoom({ url, username });
    } catch (err) {
      console.warn('[WepChat] joinRoom Fehler:', err);
    }
  }

  function sendMessage(url: string, username: string, text: string) {
    if (!conn || !state.connected) {
      console.warn('[WepChat] Nicht verbunden, Nachricht verworfen.');
      return;
    }
    const clean = text.trim();
    if (!clean) return;
    try {
      conn.reducers.sendMessage({ url, username, text: clean });
    } catch (err) {
      console.error('[WepChat] Sende-Fehler:', err);
    }
  }

  function disconnect() {
    if (conn) {
      try { conn.reducers.leaveRoom({}); } catch {}
      conn.disconnect();
      conn = null;
    }
    state.connected = false;
    state.messages = [];
    subscribedUrl = '';
  }

  return {
    get current() { return state; },
    connect,
    subscribeToUrl,
    sendMessage,
    disconnect,
  };
}

export const spacetimeChat = createSpacetimeChat();
