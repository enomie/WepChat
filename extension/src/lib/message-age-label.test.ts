import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Timestamp } from 'spacetimedb';
import {
  formatMessageAgeLabel,
  MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS,
} from './message-age-label.ts';

const JUST_NOW_DE = 'Gerade eben';
const baseNow = Date.UTC(2025, 5, 1, 12, 0, 0);

function atOffsetMs(offsetMs: number): Timestamp {
  return Timestamp.fromDate(new Date(baseNow + offsetMs));
}

describe('formatMessageAgeLabel', () => {
  it('shows just-now label below 1 minute', () => {
    assert.equal(
      formatMessageAgeLabel(atOffsetMs(-30_000), 'de', baseNow, JUST_NOW_DE),
      JUST_NOW_DE
    );
    assert.equal(
      formatMessageAgeLabel(
        atOffsetMs(-MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS + 1),
        'de',
        baseNow,
        JUST_NOW_DE
      ),
      JUST_NOW_DE
    );
  });

  it('switches to relative minutes at 1 minute (de)', () => {
    const label = formatMessageAgeLabel(
      atOffsetMs(-MESSAGE_AGE_LABEL_JUST_NOW_MAX_MS),
      'de',
      baseNow,
      JUST_NOW_DE
    );
    assert.equal(label, 'vor 1 Minute');
  });

  it('switches to relative minutes at 1 minute (en)', () => {
    const label = formatMessageAgeLabel(
      atOffsetMs(-90_000),
      'en',
      baseNow,
      'Just now'
    );
    assert.equal(label, '1 minute ago');
  });

  it('uses hours and days for older messages', () => {
    assert.equal(
      formatMessageAgeLabel(atOffsetMs(-2 * 60 * 60_000), 'de', baseNow, JUST_NOW_DE),
      'vor 2 Stunden'
    );
    assert.equal(
      formatMessageAgeLabel(atOffsetMs(-2 * 24 * 60 * 60_000), 'en', baseNow, 'Just now'),
      '2 days ago'
    );
  });
});
