import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  buildOnlineCountSql,
  clearOnlineCountCache,
  formatBadgeText,
  getCachedOnlineCount,
  LIVE_BADGE_CACHE_TTL_MS,
  parseOnlineCountSqlResponse,
  setCachedOnlineCount,
} from './live-badge.ts';

describe('formatBadgeText', () => {
  it('returns empty for 0 or 1', () => {
    assert.equal(formatBadgeText(0), '');
    assert.equal(formatBadgeText(1), '');
  });

  it('returns exact count from 2 to 999', () => {
    assert.equal(formatBadgeText(2), '2');
    assert.equal(formatBadgeText(999), '999');
  });

  it('caps at 99+ from 1000', () => {
    assert.equal(formatBadgeText(1000), '99+');
    assert.equal(formatBadgeText(5000), '99+');
  });
});

describe('parseOnlineCountSqlResponse', () => {
  it('reads Spacetime SQL JSON shape', () => {
    const data = [{ rows: [[42]] }];
    assert.equal(parseOnlineCountSqlResponse(data), 42);
  });

  it('returns 0 for empty or invalid payloads', () => {
    assert.equal(parseOnlineCountSqlResponse(undefined), 0);
    assert.equal(parseOnlineCountSqlResponse([]), 0);
    assert.equal(parseOnlineCountSqlResponse([{ rows: [] }]), 0);
    assert.equal(parseOnlineCountSqlResponse([{ rows: [['nope']] }]), 0);
  });
});

describe('online count cache', () => {
  beforeEach(() => {
    clearOnlineCountCache();
  });

  it('returns cached value within TTL', () => {
    const url = 'https://example.com/page';
    const now = 1_000_000;
    setCachedOnlineCount(url, 5, now);
    assert.equal(getCachedOnlineCount(url, now + 1000), 5);
  });

  it('misses after TTL', () => {
    const url = 'https://example.com/page';
    const now = 1_000_000;
    setCachedOnlineCount(url, 5, now);
    assert.equal(
      getCachedOnlineCount(url, now + LIVE_BADGE_CACHE_TTL_MS),
      null,
    );
  });
});

describe('buildOnlineCountSql', () => {
  it('escapes single quotes in URL', () => {
    const sql = buildOnlineCountSql("https://example.com/x'y");
    assert.match(sql, /current_url = 'https:\/\/example.com\/x''y'/);
  });
});
