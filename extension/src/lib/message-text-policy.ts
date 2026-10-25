/**
 * Erlaubte Zeichen + Längen, docs/requirements/message-content.md
 */
const ALLOWED_CHAR_PATTERN = /[^A-Za-z0-9\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF ,.\-]/g;

export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 13;
export const MAX_MESSAGE_LENGTH = 400;

export function isUsernameReadyForCommit(prepared: string): boolean {
  const len = prepared.length;
  return len >= MIN_USERNAME_LENGTH && len <= MAX_USERNAME_LENGTH;
}

export function filterMessageInput(value: string, maxLength = MAX_MESSAGE_LENGTH): string {
  return value.replace(ALLOWED_CHAR_PATTERN, '').slice(0, maxLength);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function prepareMessageForSend(value: string): string {
  const filtered = filterMessageInput(value, MAX_MESSAGE_LENGTH);
  return normalizeWhitespace(filtered).slice(0, MAX_MESSAGE_LENGTH);
}

export function prepareUsername(value: string): string {
  const filtered = filterMessageInput(value, MAX_USERNAME_LENGTH);
  return normalizeWhitespace(filtered).slice(0, MAX_USERNAME_LENGTH);
}

export function isAllowedText(s: string): boolean {
  return filterMessageInput(s) === s;
}
