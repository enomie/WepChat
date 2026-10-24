import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterMessageInput,
  MAX_MESSAGE_LENGTH,
  MAX_USERNAME_LENGTH,
  prepareMessageForSend,
  prepareUsername,
} from './message-text-policy.ts';

describe('message-text-policy lengths', () => {
  it('caps username input at 13 characters', () => {
    const raw = 'A'.repeat(20);
    assert.equal(filterMessageInput(raw, MAX_USERNAME_LENGTH).length, MAX_USERNAME_LENGTH);
    assert.equal(prepareUsername(raw).length, MAX_USERNAME_LENGTH);
  });

  it('caps message input at 400 characters', () => {
    const raw = 'x'.repeat(500);
    assert.equal(filterMessageInput(raw).length, MAX_MESSAGE_LENGTH);
    assert.equal(prepareMessageForSend(raw).length, MAX_MESSAGE_LENGTH);
  });

  it('counts umlauts as one character in prepare', () => {
    const name = 'Ä'.repeat(13);
    assert.equal(prepareUsername(name).length, 13);
    assert.equal(prepareUsername(name + 'z').length, 13);
  });
});
