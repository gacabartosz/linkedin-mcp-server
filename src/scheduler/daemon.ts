import { getDuePosts, updateScheduleStatus } from "./store.js";
import { publishScheduledPost } from "./publisher.js";
import { log } from "../utils/logger.js";

const TICK_INTERVAL_MS = 30_000; // 30 seconds
const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000; // 24 hours

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSchedulerDaemon(): void {
  if (intervalId) return;

  log("info", "Scheduler daemon started (30s tick interval)");

  // Immediate catch-up tick on startup
  tick().catch((err) => log("error", "Startup tick failed", err));

  intervalId = setInterval(() => {
    tick().catch((err) => log("error", "Scheduler tick failed", err));
  }, TICK_INTERVAL_MS);
}

export function stopSchedulerDaemon(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log("info", "Scheduler daemon stopped");
  }
}

async function tick(): Promise<void> {
  const duePosts = getDuePosts();

  if (duePosts.length === 0) return;

  log("info", `Scheduler tick: ${duePosts.length} post(s) due`);

  for (const post of duePosts) {
    // Check if post is too old (>24h overdue)
    const publishAt = new Date(post.publish_at).getTime();
    const overdueMs = Date.now() - publishAt;

    if (overdueMs > MAX_OVERDUE_MS) {
      updateScheduleStatus(post.id, "failed", {
        error: `Missed publish window (${Math.round(overdueMs / 3600000)}h overdue, max 24h)`,
      });
      log("warn", `Skipped overdue post ${post.id} (${Math.round(overdueMs / 3600000)}h late)`);
      continue;
    }

    await publishScheduledPost(post);
  }
}
