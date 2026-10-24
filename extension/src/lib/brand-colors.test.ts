import assert from 'node:assert/strict';
import test from 'node:test';
import { WEPCHAT_GREEN, WHATSAPP_GREEN_REFERENCE } from './brand-colors.ts';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('WepChat green is not WhatsApp green', () => {
  assert.notEqual(WEPCHAT_GREEN.toLowerCase(), WHATSAPP_GREEN_REFERENCE.toLowerCase());
  const d = rgbDistance(hexToRgb(WEPCHAT_GREEN), hexToRgb(WHATSAPP_GREEN_REFERENCE));
  assert.ok(d > 40, `expected clear separation from WhatsApp green, got distance ${d}`);
});
