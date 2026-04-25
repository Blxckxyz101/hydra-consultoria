/**
 * SKY QUEUE — Request queue + per-user rate limiter for SkyNet commands.
 *
 * - MAX_CONCURRENT: at most N requests hitting SkyNet simultaneously
 * - RATE_LIMIT_MS : cooldown per user between requests
 * - onUpdate      : called whenever the entry's position changes so the
 *                   bot can edit the Discord/Telegram message live.
 */

const MAX_CONCURRENT  = 2;
const RATE_LIMIT_MS   = 30_000; // 30 seconds between requests per user

export interface QueuePosition {
  /** 1-indexed position in waiting list (1 = next up). 0 means currently running. */
  waitPos:   number;
  /** Number of requests ahead of this one in the waiting list. */
  ahead:     number;
  /** Total requests in the system (running + waiting). */
  total:     number;
  /** How many are currently being processed. */
  running:   number;
  /** True when this request is actively being processed. */
  isRunning: boolean;
}

type OnUpdate = (pos: QueuePosition) => Promise<void>;

interface Entry {
  userId:    string;
  task:      () => Promise<string | null>;
  resolve:   (v: string | null) => void;
  reject:    (e: unknown) => void;
  onUpdate:  OnUpdate;
  running:   boolean;
}

let runningCount = 0;
const waitingList: Entry[] = [];
const rateLimits  = new Map<string, number>(); // userId → last request timestamp

// ── Public: rate limit check ──────────────────────────────────────────────────

/** Returns ms remaining in cooldown, or 0 if the user can make a request now. */
export function getRateLimitRemaining(userId: string): number {
  const last = rateLimits.get(userId);
  if (!last) return 0;
  return Math.max(0, RATE_LIMIT_MS - (Date.now() - last));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildPos(entry: Entry): QueuePosition {
  if (entry.running) {
    return { waitPos: 0, ahead: 0, total: runningCount + waitingList.length, running: runningCount, isRunning: true };
  }
  const idx = waitingList.indexOf(entry);
  return {
    waitPos:   idx + 1,
    ahead:     idx,
    total:     runningCount + waitingList.length,
    running:   runningCount,
    isRunning: false,
  };
}

function notifyWaiters() {
  for (const e of waitingList) {
    void e.onUpdate(buildPos(e)).catch(() => {});
  }
}

function processNext() {
  while (runningCount < MAX_CONCURRENT && waitingList.length > 0) {
    const entry = waitingList.shift()!;
    runningCount++;
    entry.running = true;
    rateLimits.set(entry.userId, Date.now());

    // Notify this entry it's now running, then notify remaining waiters
    void entry.onUpdate(buildPos(entry)).catch(() => {});
    notifyWaiters();

    entry.task()
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        runningCount--;
        processNext();
        notifyWaiters();
      });
  }
}

// ── Public: enqueue ───────────────────────────────────────────────────────────

/**
 * Add a SkyNet request to the queue.
 * `onUpdate` is called immediately with the initial position, and again
 * every time the position changes (someone finishes ahead of you).
 */
export function enqueueRequest(
  userId:   string,
  task:     () => Promise<string | null>,
  onUpdate: OnUpdate,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const entry: Entry = { userId, task, resolve, reject, onUpdate, running: false };
    waitingList.push(entry);

    // Notify immediately with initial position
    void onUpdate(buildPos(entry)).catch(() => {});

    processNext();
  });
}

// ── Queue status (for /sky status) ───────────────────────────────────────────
export function getQueueStatus() {
  return { running: runningCount, waiting: waitingList.length, maxConcurrent: MAX_CONCURRENT };
}
