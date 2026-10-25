/**
 * SpacetimeDB connection state für WepChat.
 * Vereinfacht: kein Race-Condition-Loop, kein overengineering.
 */
import { DbConnection } from './spacetimedb';
import type { ChatMessage } from './spacetimedb/types';
import { rateLimitState } from './rate-limit.svelte';
import { normalizeNickColorId } from './nick-colors';
import { prepareMessageForSend } from './message-text-policy';
import {
  DEFAULT_VISIBLE_LIMIT,
  hasOlderMessages,
  nextVisibleLimit,
  MESSAGE_PAGE_SIZE,
} from './message-history';
import { escapeSqlStringLiteral } from './sql-literal-escape';
import { BADGE_COLOR, formatBadgeText } from './live-badge';

const SPACETIMEDB_URI = 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = 'wepchat';

export type ChatConnectionError = 'connect' | 'build';

export interface ChatState {
  connected: boolean;
  onlineCount: number;
  messages: ChatMessage[];
  visibleLimit: number;
  identity: string | null;
  roomDisplayName: string | null;
  error: ChatConnectionError | null;
}

/** Server auth uses identity; UI also matches room display name for reliable own-bubble detection. */
export function messageIsMine(
  msg: ChatMessage,
  identityHex: string | null,
  roomDisplayName: string | null,
  localUsername: string,
): boolean {
  if (identityHex) {
    const mine =
      msg.senderIdentity.toHexString().toLowerCase() === identityHex.toLowerCase();
    if (mine) return true;
  }
  const label = (roomDisplayName ?? localUsername).trim();
  return label.length > 0 && msg.senderName === label;
}

/** @deprecated Use messageIsMine for UI; kept for tests/call sites */
export function isOwnMessage(msg: ChatMessage, identityHex: string | null): boolean {
  return messageIsMine(msg, identityHex, null, '');
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
    roomDisplayName: null,
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
          syncOwnRoomDisplayName();
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

      conn.db.user_session.onInsert(onUserSessionChange);
      conn.db.user_session.onUpdate(onUserSessionChange);
      conn.db.user_session.onDelete(onUserSessionChange);
    } catch (err) {
      console.error('[WepChat] Client build error:', err);
      state.error = 'build';
    }
  }

  function syncOwnRoomDisplayName() {
    if (!conn || !subscribedUrl || !state.identity) {
      state.roomDisplayName = null;
      return;
    }
    for (const session of conn.db.user_session.iter()) {
      if (
        session.currentUrl === subscribedUrl &&
        session.identity.toHexString() === state.identity
      ) {
        state.roomDisplayName = session.username;
        return;
      }
    }
    state.roomDisplayName = null;
  }

  function onUserSessionChange() {
    recountOnline();
    syncOwnRoomDisplayName();
  }

  function recountOnline() {
    if (!conn || !subscribedUrl) return;
    let count = 0;
    for (const session of conn.db.user_session.iter()) {
      if (session.currentUrl === subscribedUrl) count++;
    }
    state.onlineCount = count;

    // Badge synchronisieren, wenn Sidepanel offen ist
    if (browser.action) {
      browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) {
          const text = formatBadgeText(count);
          browser.action.setBadgeText({ text, tabId: tab.id }).catch(() => {});
          if (text) {
            browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId: tab.id }).catch(() => {});
          }
        }
      }).catch(() => {});
    }
  }

  function syncPresence(url: string, username: string, nickColorId: number) {
    if (!conn || !state.connected || !url) return;
    try {
      conn.reducers.joinRoom({
        url,
        username,
        nickColor: normalizeNickColorId(nickColorId),
      });
    } catch (err) {
      console.warn('[WepChat] joinRoom error:', err);
    }
  }

  function clearRoomPresence() {
    if (!conn || !state.connected || !subscribedUrl) return;
    try {
      conn.reducers.leaveRoom({});
    } catch (err) {
      console.warn('[WepChat] leaveRoom error:', err);
    }
    subscribedUrl = '';
    state.messages = [];
    state.visibleLimit = DEFAULT_VISIBLE_LIMIT;
    state.onlineCount = 0;
    state.roomDisplayName = null;
  }

  function subscribeToUrl(url: string, username: string, nickColorId: number) {
    if (!conn || !state.connected) return;

    if (subscribedUrl !== url) {
      subscribedUrl = url;
      state.messages = [];
      state.visibleLimit = DEFAULT_VISIBLE_LIMIT;
      state.onlineCount = 0;
      state.roomDisplayName = null;

      conn
        .subscriptionBuilder()
        .onApplied((_ctx) => {
          if (!conn) return;
          const msgs: ChatMessage[] = [];
          for (const msg of conn.db.chat_message.iter()) {
            if (msg.url === url) msgs.push(msg);
          }
          state.messages = msgs.sort((a, b) => Number(a.id) - Number(b.id));
          onUserSessionChange();
        })
        .subscribe([
          `SELECT * FROM chat_message WHERE url = '${escapeSqlStringLiteral(url)}'`,
          `SELECT * FROM user_session WHERE current_url = '${escapeSqlStringLiteral(url)}'`,
        ]);
    }

    syncPresence(url, username, nickColorId);
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

  function deleteOwnMessage(messageId: bigint) {
    if (!conn || !state.connected) {
      console.warn('[WepChat] Not connected; delete dropped.');
      return;
    }
    try {
      conn.reducers.deleteOwnMessage({ messageId });
    } catch (err) {
      console.warn('[WepChat] deleteOwnMessage error:', err);
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
    state.roomDisplayName = null;
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
    clearRoomPresence,
    sendMessage,
    deleteOwnMessage,
    disconnect,
    loadOlderVisible,
  };
}

export const spacetimeChat = createSpacetimeChat();
