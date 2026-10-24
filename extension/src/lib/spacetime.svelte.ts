/**
 * SpacetimeDB connection state für WepChat.
 * Vereinfacht: kein Race-Condition-Loop, kein overengineering.
 */
import { DbConnection } from './spacetimedb';
import type { ChatMessage } from './spacetimedb/types';
import { rateLimitState } from './rate-limit.svelte';
import { prepareMessageForSend } from './message-text-policy';
import {
  DEFAULT_VISIBLE_LIMIT,
  hasOlderMessages,
  nextVisibleLimit,
  MESSAGE_PAGE_SIZE,
} from './message-history';

const SPACETIMEDB_URI = 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = 'wepchat';

export type ChatConnectionError = 'connect' | 'build';

export interface ChatState {
  connected: boolean;
  onlineCount: number;
  messages: ChatMessage[];
  visibleLimit: number;
  identity: string | null;
  error: ChatConnectionError | null;
}

function createSpacetimeChat() {
  let conn: DbConnection | null = null;
  let subscribedUrl = '';

  let state = $state<ChatState>({
    connected: false,
    onlineCount: 0,
    messages: [],
    visibleLimit: DEFAULT_VISIBLE_LIMIT,
    identity: null,
    error: null,
  });

  function connect() {
    if (conn) return; // bereits verbunden oder verbindet

    console.log('[WepChat] Connecting to SpacetimeDB...');

    try {
      conn = DbConnection.builder()
        .withUri(SPACETIMEDB_URI)
        .withDatabaseName(MODULE_NAME)
        .onConnect((_connection, identity, _token) => {
          console.log('[WepChat] Connected. Identity:', identity.toHexString());
          state.connected = true;
          state.identity = identity.toHexString();
          state.error = null;
        })
        .onDisconnect((_connection, _error) => {
          console.warn('[WepChat] Disconnected.');
          state.connected = false;
        })
        .onConnectError((_ctx, err) => {
          console.error('[WepChat] Connection error:', err);
          state.connected = false;
          state.error = 'connect';
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

      conn.db.chat_message.onDelete((_ctx, row) => {
        if (row.url === subscribedUrl) {
          state.messages = state.messages.filter((m) => m.id !== row.id);
        }
      });

      conn.db.user_session.onInsert(recountOnline);
      conn.db.user_session.onUpdate(recountOnline);
      conn.db.user_session.onDelete(recountOnline);
    } catch (err) {
      console.error('[WepChat] Client build error:', err);
      state.error = 'build';
    }
  }

  function recountOnline() {
    if (!conn || !subscribedUrl) return;
    let count = 0;
    for (const session of conn.db.user_session.iter()) {
      if (session.currentUrl === subscribedUrl) count++;
    }
    state.onlineCount = count;

    // Badge synchronisieren, wenn Sidepanel offen ist
    if (typeof chrome !== 'undefined' && chrome.action) {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) {
          const text = count > 1 ? (count > 999 ? '99+' : String(count)) : '';
          chrome.action.setBadgeText({ text, tabId: tab.id }).catch(() => {});
          if (text) {
            chrome.action.setBadgeBackgroundColor({ color: '#2563EB', tabId: tab.id }).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }

  function subscribeToUrl(url: string, username: string) {
    if (!conn || !state.connected) return; // warten bis connected

    if (subscribedUrl === url) return; // bereits abonniert
    subscribedUrl = url;
    state.messages = [];
    state.visibleLimit = DEFAULT_VISIBLE_LIMIT;
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
      console.warn('[WepChat] joinRoom error:', err);
    }
  }

  function sendMessage(url: string, username: string, text: string) {
    if (!conn || !state.connected) {
      console.warn('[WepChat] Not connected; message dropped.');
      return;
    }
    const clean = prepareMessageForSend(text);
    if (!clean) return;
    try {
      conn.reducers.sendMessage({ url, username, text: clean });
      rateLimitState.recordSend();
    } catch (err) {
      console.error('[WepChat] Send error:', err);
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
    state.visibleLimit = DEFAULT_VISIBLE_LIMIT;
    subscribedUrl = '';
  }

  function loadOlderVisible() {
    const total = state.messages.length;
    if (!hasOlderMessages(total, state.visibleLimit)) return;
    state.visibleLimit = nextVisibleLimit(
      state.visibleLimit,
      MESSAGE_PAGE_SIZE,
      total
    );
  }

  return {
    get current() { return state; },
    connect,
    subscribeToUrl,
    sendMessage,
    disconnect,
    loadOlderVisible,
  };
}

export const spacetimeChat = createSpacetimeChat();
