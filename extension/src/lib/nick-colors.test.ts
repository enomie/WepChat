import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NICK_COLOR_ID,
  nickColorStyles,
  normalizeNickColorId,
} from './nick-colors.ts';

describe('normalizeNickColorId', () => {
  it('keeps valid ids 1..9', () => {
    for (let id = 1; id <= 9; id++) {
      assert.equal(normalizeNickColorId(id), id);
    }
  });

  it('defaults invalid values to blue', () => {
    assert.equal(normalizeNickColorId(0), DEFAULT_NICK_COLOR_ID);
    assert.equal(normalizeNickColorId(10), DEFAULT_NICK_COLOR_ID);
    assert.equal(normalizeNickColorId('x'), DEFAULT_NICK_COLOR_ID);
  });
});

describe('nickColorStyles', () => {
  it('uses palette hex and color-mix for bubble', () => {
    const styles = nickColorStyles(1);
    assert.equal(styles.senderColor, '#014D9E');
    assert.match(styles.bubbleBackground, /color-mix\(in srgb, #014D9E 14%, white\)/);
  });
});
