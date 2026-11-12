import { setTimeout as delay } from "node:timers/promises";
import type { RequestSource, WidgetMessage } from "./S3RequestSource.ts";
import { logger } from "./logger.ts";

const INACTIVITY_TIMEOUT_MS = 30000;

export async function consumeRequests(
  source: RequestSource,
  processor: { processMessage(message: WidgetMessage): Promise<void> },
  intervalMs: number,
  signal: AbortSignal,
): Promise<void> {
  const idleController = new AbortController();
  const waitSignal = AbortSignal.any([signal, idleController.signal]);
  let idleTimer = setTimeout(() => idleController.abort(), INACTIVITY_TIMEOUT_MS);

  try {
    while (!waitSignal.aborted) {
      let received = false;
      let failed = false;
      try {
        const message = await source.receiveOne(waitSignal);
        if (waitSignal.aborted) break;
        if (message) {
          received = true;
          clearTimeout(idleTimer);
          await source.acknowledge(message);
          await processor.processMessage(message);
        }
      } catch (error) {
        failed = true;
        if (!(waitSignal.aborted && error instanceof Error && error.name === "AbortError")) {
          logger.error("Error consuming widget task", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (waitSignal.aborted) break;
      if (received) {
        idleTimer = setTimeout(() => idleController.abort(), INACTIVITY_TIMEOUT_MS);
        if (!failed) continue;
      }
      try {
        await delay(intervalMs, undefined, { signal: waitSignal });
      } catch (error) {
        if (!waitSignal.aborted) throw error;
      }
    }
  } finally {
    clearTimeout(idleTimer);
  }
  if (idleController.signal.aborted && !signal.aborted) {
    logger.info("Stopping after 30 seconds without requests");
  }
}
