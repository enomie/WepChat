import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeSqlStringLiteral } from './sql-literal-escape.ts';

describe('escapeSqlStringLiteral', () => {
  it('leaves normal URLs unchanged', () => {
    assert.equal(
      escapeSqlStringLiteral('https://example.com/path?q=1'),
      'https://example.com/path?q=1',
    );
  });

  it('doubles single quotes', () => {
    assert.equal(
      escapeSqlStringLiteral("https://example.com/?q=it's"),
      "https://example.com/?q=it''s",
    );
  });

  it('handles empty string', () => {
    assert.equal(escapeSqlStringLiteral(''), '');
  });
});
