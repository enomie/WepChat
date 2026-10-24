import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasOlderMessages,
  nextVisibleLimit,
  visibleMessagesSlice,
  MESSAGE_PAGE_SIZE,
} from './message-history.ts';

function ids(...values: number[]) {
  return values.map((id) => ({ id: BigInt(id) }));
}

describe('visibleMessagesSlice', () => {
  it('returns last N by array order', () => {
    const all = ids(1, 2, 3, 4, 5);
    const slice = visibleMessagesSlice(all, 2);
    assert.deepEqual(slice.map((m) => Number(m.id)), [4, 5]);
  });

  it('returns all when limit exceeds length', () => {
    const all = ids(10, 20);
    assert.equal(visibleMessagesSlice(all, 100).length, 2);
  });

  it('returns empty for zero limit', () => {
    assert.equal(visibleMessagesSlice(ids(1), 0).length, 0);
  });
});

describe('hasOlderMessages', () => {
  it('true when more messages than visible', () => {
    assert.equal(hasOlderMessages(250, 100), true);
  });

  it('false when all visible', () => {
    assert.equal(hasOlderMessages(100, 100), false);
    assert.equal(hasOlderMessages(50, 100), false);
  });
});

describe('nextVisibleLimit', () => {
  it('adds page size capped at total', () => {
    assert.equal(nextVisibleLimit(100, MESSAGE_PAGE_SIZE, 250), 200);
    assert.equal(nextVisibleLimit(200, MESSAGE_PAGE_SIZE, 250), 250);
  });
});
