import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeRequests } from "../lib/Consumer.ts";
import type { RequestSource, WidgetMessage } from "../lib/S3RequestSource.ts";

describe("polling consumer", () => {
  it("acknowledges and processes each message before reading the next", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const message = { key: "first", body: "{}" };
    const source: RequestSource = {
      async receiveOne() {
        events.push("receive");
        if (events.length === 1) return message;
        controller.abort();
        return undefined;
      },
      async acknowledge(value) {
        assert.equal(value, message);
        events.push("acknowledge");
      },
    };
    await consumeRequests(source, {
      async processMessage(value: WidgetMessage) {
        assert.equal(value, message);
        events.push("process");
      },
    }, 10000, controller.signal);
    assert.deepEqual(events, ["receive", "acknowledge", "process", "receive"]);
  });

  it("waits after an empty poll and stops promptly when aborted during the wait", async () => {
    const controller = new AbortController();
    let reads = 0;
    const source: RequestSource = {
      async receiveOne() {
        reads++;
        setTimeout(() => controller.abort(), 20);
        return undefined;
      },
      async acknowledge() { assert.fail("unexpected acknowledgement"); },
    };
    await consumeRequests(source, {
      async processMessage() { assert.fail("unexpected processing"); },
    }, 10000, controller.signal);
    assert.equal(reads, 1);
  });

  it("waits and retries after a failure without processing an unacknowledged message", async () => {
    const controller = new AbortController();
    let reads = 0;
    let acknowledgedAt = 0;
    let retryDelay = 0;
    const source: RequestSource = {
      async receiveOne() {
        reads++;
        if (reads === 2) {
          retryDelay = performance.now() - acknowledgedAt;
          controller.abort();
          return undefined;
        }
        return { key: "first", body: "{}" };
      },
      async acknowledge() {
        acknowledgedAt = performance.now();
        throw new Error("delete failed");
      },
    };
    await consumeRequests(source, {
      async processMessage() { assert.fail("unexpected processing"); },
    }, 25, controller.signal);
    assert.equal(reads, 2);
    assert.ok(retryDelay >= 15);
  });

  it("leaves a received request untouched if stopped before acknowledgement", async () => {
    const controller = new AbortController();
    await consumeRequests({
      async receiveOne() {
        controller.abort();
        return { key: "first", body: "{}" };
      },
      async acknowledge() { assert.fail("unexpected acknowledgement"); },
    }, {
      async processMessage() { assert.fail("unexpected processing"); },
    }, 100, controller.signal);
  });

  it("finishes processing when stopped during acknowledgement", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    await consumeRequests({
      async receiveOne() { events.push("receive"); return { key: "first", body: "{}" }; },
      async acknowledge() { events.push("acknowledge"); controller.abort(); },
    }, {
      async processMessage() { events.push("process"); },
    }, 100, controller.signal);
    assert.deepEqual(events, ["receive", "acknowledge", "process"]);
  });

  it("stops at 30 seconds of inactivity even when the polling interval is longer", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let finished = false;
    const run = consumeRequests({
      async receiveOne() { return undefined; },
      async acknowledge() { assert.fail("unexpected acknowledgement"); },
    }, {
      async processMessage() { assert.fail("unexpected processing"); },
    }, 60000, new AbortController().signal).then(() => { finished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(29_999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    t.mock.timers.tick(1);
    await run;
    assert.equal(finished, true);
  });

  it("restarts the idle timeout after a request finishes processing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let deliver!: (message: WidgetMessage) => void;
    let finishProcessing!: () => void;
    let reads = 0;
    let finished = false;
    const run = consumeRequests({
      receiveOne(signal) {
        reads++;
        if (reads === 1) {
          return new Promise<WidgetMessage>((resolve) => { deliver = resolve; });
        }
        return new Promise<undefined>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }, { once: true });
        });
      },
      async acknowledge() {},
    }, {
      processMessage() {
        return new Promise<void>((resolve) => { finishProcessing = resolve; });
      },
    }, 100, new AbortController().signal).then(() => { finished = true; });

    t.mock.timers.tick(20000);
    deliver({ key: "request", body: "{}" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(60000);
    assert.equal(finished, false);
    finishProcessing();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 2);
    t.mock.timers.tick(29_999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    t.mock.timers.tick(1);
    await run;
    assert.equal(finished, true);
  });
});
