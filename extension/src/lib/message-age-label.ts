import type { Timestamp } from 'spacetimedb';

/** Upper bound for fixed "just now" copy; see docs/requirements/message-age-label.md */
export const MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS = 60_000;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function timestampToMillis(createdAt: Timestamp): number {
  return Number(createdAt.toMillis());
}

export function formatMessageAgeIso(createdAt: Timestamp): string {
  return createdAt.toISOString();
}

export function formatMessageAgeLabel(
  createdAt: Timestamp,
  locale: string,
  nowMs: number,
  justNowLabel: string
): string {
  const ageMs = nowMs - timestampToMillis(createdAt);
  if (ageMs < MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS) {
    return justNowLabel;
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const ageMinutes = Math.floor(ageMs / MS_PER_MINUTE);
  if (ageMinutes < 60) {
    return rtf.format(-ageMinutes, 'minute');
  }

  const ageHours = Math.floor(ageMs / MS_PER_HOUR);
  if (ageHours < 24) {
    return rtf.format(-ageHours, 'hour');
  }

  const ageDays = Math.floor(ageMs / MS_PER_DAY);
  return rtf.format(-ageDays, 'day');
}
