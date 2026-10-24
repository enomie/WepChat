/**
 * Client-side chat window (slice) — docs/requirements/message-history-pagination.md §4.2
 */
import type { ChatMessage } from './spacetimedb/types';

export const MESSAGE_PAGE_SIZE = 100;

export const DEFAULT_VISIBLE_LIMIT = MESSAGE_PAGE_SIZE;

const AUTO_SCROLL_THRESHOLD_PX = 100;

/** Assumes `all` is sorted ascending by id (as in spacetime state). */
export function visibleMessagesSlice<T extends { id: bigint | number }>(
  all: readonly T[],
  visibleLimit: number
): T[] {
  if (visibleLimit <= 0 || all.length === 0) return [];
  const start = Math.max(0, all.length - visibleLimit);
  return all.slice(start);
}

export function hasOlderMessages(totalCount: number, visibleLimit: number): boolean {
  return totalCount > visibleLimit;
}

export function nextVisibleLimit(
  current: number,
  pageSize: number,
  total: number
): number {
  if (total <= 0) return DEFAULT_VISIBLE_LIMIT;
  return Math.min(current + pageSize, total);
}

export function shouldAutoScrollToBottom(
  el: HTMLElement | null,
  thresholdPx = AUTO_SCROLL_THRESHOLD_PX
): boolean {
  if (!el) return true;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distanceFromBottom <= thresholdPx;
}

/** Keep scroll position stable after prepending older messages in the DOM. */
export function applyScrollAnchorAfterPrepend(
  el: HTMLElement,
  prevScrollHeight: number,
  prevScrollTop: number
): void {
  el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;
}

export type VisibleMessage = ChatMessage;
