const MAX_SENDS_PER_WINDOW = 2;
const WINDOW_MS = 60_000;

function createRateLimitState() {
  let sendTimestamps = $state<number[]>([]);
  let tick = $state(0);

  function prune(now: number) {
    sendTimestamps = sendTimestamps.filter((t) => now - t < WINDOW_MS);
  }

  /** Read-only — no $state writes (safe inside $derived). */
  function activeTimestamps(now: number): number[] {
    return sendTimestamps.filter((t) => now - t < WINDOW_MS);
  }

  function recordSend() {
    const now = Date.now();
    prune(now);
    sendTimestamps = [...sendTimestamps, now];
  }

  function cooldownRemainingMs(): number {
    void tick;
    const now = Date.now();
    const active = activeTimestamps(now);
    if (active.length < MAX_SENDS_PER_WINDOW) {
      return 0;
    }
    const oldest = active[0]!;
    return Math.max(0, WINDOW_MS - (now - oldest));
  }

  function canSend(): boolean {
    return cooldownRemainingMs() === 0;
  }

  function bumpTick() {
    prune(Date.now());
    tick++;
  }

  return {
    recordSend,
    canSend,
    cooldownRemainingMs,
    bumpTick,
  };
}

export const rateLimitState = createRateLimitState();
