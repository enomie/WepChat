import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cleanUrl,
  isChatEligibleParsedUrl,
  isPrivateOrLocalHost,
  resolveTabChatUrl,
} from './url-utils.ts';

describe('isPrivateOrLocalHost', () => {
  it('blocks localhost names', () => {
    assert.equal(isPrivateOrLocalHost('localhost'), true);
    assert.equal(isPrivateOrLocalHost('localhost.localdomain'), true);
    assert.equal(isPrivateOrLocalHost('LOCALHOST'), true);
  });

  it('blocks IPv4 loopback and private ranges', () => {
    assert.equal(isPrivateOrLocalHost('127.0.0.1'), true);
    assert.equal(isPrivateOrLocalHost('127.1.2.3'), true);
    assert.equal(isPrivateOrLocalHost('10.0.0.1'), true);
    assert.equal(isPrivateOrLocalHost('172.16.0.1'), true);
    assert.equal(isPrivateOrLocalHost('172.31.255.1'), true);
    assert.equal(isPrivateOrLocalHost('192.168.0.1'), true);
    assert.equal(isPrivateOrLocalHost('169.254.1.1'), true);
    assert.equal(isPrivateOrLocalHost('0.0.0.0'), true);
  });

  it('allows public hostnames and non-private IPs', () => {
    assert.equal(isPrivateOrLocalHost('example.com'), false);
    assert.equal(isPrivateOrLocalHost('localhost.example.com'), false);
    assert.equal(isPrivateOrLocalHost('172.15.0.1'), false);
    assert.equal(isPrivateOrLocalHost('8.8.8.8'), false);
  });

  it('blocks IPv6 local addresses', () => {
    assert.equal(isPrivateOrLocalHost('::1'), true);
    assert.equal(isPrivateOrLocalHost('fe80::1'), true);
    assert.equal(isPrivateOrLocalHost('fd12::1'), true);
    assert.equal(isPrivateOrLocalHost('2001:db8::1'), false);
  });
});

describe('isChatEligibleParsedUrl', () => {
  it('allows https public URLs', () => {
    assert.equal(isChatEligibleParsedUrl(new URL('https://example.com/path')), true);
  });

  it('rejects non-http schemes', () => {
    assert.equal(isChatEligibleParsedUrl(new URL('chrome://settings')), false);
    assert.equal(isChatEligibleParsedUrl(new URL('file:///tmp/x')), false);
  });

  it('rejects local http URLs', () => {
    assert.equal(isChatEligibleParsedUrl(new URL('http://localhost:3000')), false);
    assert.equal(isChatEligibleParsedUrl(new URL('http://192.168.1.5/')), false);
  });
});

describe('resolveTabChatUrl', () => {
  it('classifies tab states', () => {
    assert.deepEqual(resolveTabChatUrl(undefined), { kind: 'none' });
    assert.deepEqual(resolveTabChatUrl('chrome://newtab'), { kind: 'unsupported' });
    assert.deepEqual(resolveTabChatUrl('http://127.0.0.1/app'), { kind: 'unsupported' });
    const ready = resolveTabChatUrl('https://example.com/page');
    assert.equal(ready.kind, 'ready');
    if (ready.kind === 'ready') {
      assert.equal(ready.url, 'https://example.com/page');
    }
  });
});

describe('cleanUrl', () => {
  it('returns empty for ineligible URLs', () => {
    assert.equal(cleanUrl('http://localhost:5173'), '');
    assert.equal(cleanUrl('chrome://extensions'), '');
  });

  it('still normalizes eligible URLs', () => {
    assert.equal(
      cleanUrl('https://www.youtube.com/watch?v=abc123&utm_source=x'),
      'https://www.youtube.com/watch?v=abc123'
    );
  });

  it('returns empty when normalized URL exceeds max length', () => {
    const base = 'https://example.com/?p=';
    const pad = 'a'.repeat(2048 - base.length);
    assert.equal(cleanUrl(`${base}${pad}`).length, 2048);
    assert.equal(cleanUrl(`${base}${pad}a`), '');
  });
});
