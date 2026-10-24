/**
 * Erlaubte Zeichen für Chat und Pseudonym — docs/requirements/message-content.md
 */
const ALLOWED_CHAR_PATTERN = /[^A-Za-z0-9\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF ,.\-]/g;

export function filterMessageInput(value: string): string {
  return value.replace(ALLOWED_CHAR_PATTERN, '');
}

export function prepareMessageForSend(value: string): string {
  const filtered = filterMessageInput(value);
  return filtered.replace(/\s+/g, ' ').trim();
}

export function isAllowedText(s: string): boolean {
  return filterMessageInput(s) === s;
}
