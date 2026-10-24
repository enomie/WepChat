import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocale } from './resolve-locale.ts';

describe('resolveLocale', () => {
  it('prefers German when listed first', () => {
    assert.equal(resolveLocale(['de-DE', 'en']), 'de');
  });

  it('falls back to English for unsupported languages', () => {
    assert.equal(resolveLocale(['fr']), 'en');
  });

  it('returns English for empty list', () => {
    assert.equal(resolveLocale([]), 'en');
  });

  it('normalizes en-US to en', () => {
    assert.equal(resolveLocale(['en-US']), 'en');
  });
});
