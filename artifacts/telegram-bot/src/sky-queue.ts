/**
 * SKY QUEUE — Request queue + per-user rate limiter for SkyNet commands.
 * Same logic as discord-bot/src/sky-queue.ts — kept separate per package.
 */

const MAX_CONCURRENT = 2;
const RATE_LIMIT_MS  = 30_000; // 30 seconds per user

export interface QueuePosition {
  waitPos:   number;   // 1-indexed position in waiting list (0 = currently running)
  ahead:     number;   // people waiting before you
  total:     number;   // running + waiting
  running:   number;   // currently being processed
  isRunning: boolean;
}

type OnUpdate = (pos: QueuePosition) => Promise<void>;

interface Entry {
  userId:   string;
  task:     () => Promise<string | null>;
  resolve:  (v: string | null) => void;
  reject:   (e: unknown) => void;
  onUpdate: OnUpdate;
  running:  boolean;
}

let runningCount = 0;
const waitingList: Entry[] = [];
const rateLimits = new Map<string, number>();

export function getRateLimitRemaining(userId: string): number {
  const last = rateLimits.get(userId);
  if (!last) return 0;
  return Math.max(0, RATE_LIMIT_MS - (Date.now() - last));
}

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

export function enqueueRequest(
  userId:   string,
  task:     () => Promise<string | null>,
  onUpdate: OnUpdate,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const entry: Entry = { userId, task, resolve, reject, onUpdate, running: false };
    waitingList.push(entry);
    void onUpdate(buildPos(entry)).catch(() => {});
    processNext();
  });
}

export function getQueueStatus() {
  return { running: runningCount, waiting: waitingList.length, maxConcurrent: MAX_CONCURRENT };
}
