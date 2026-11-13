import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { it } from "node:test";
import winston from "winston";
import { logger } from "../lib/logger.ts";
import { WidgetProcessor } from "../lib/WidgetProcessor.ts";

it("logs validation, missing-widget, and storage failure reasons", async () => {
  let output = "";
  const transport = new winston.transports.Stream({
    stream: new Writable({
      write(chunk, _encoding, callback) { output += chunk.toString(); callback(); },
    }),
  });
  logger.add(transport);
  const failure = new Error("storage unavailable");
  const processor = new WidgetProcessor({
    async create() { throw failure; },
    async update() { return false; },
    async delete() { return false; },
  });
  const request = { requestId: "r", widgetId: "w", owner: "Jane Doe" };
  try {
    await processor.processMessage({ key: "bad", body: "{}" });
    await processor.processMessage({ key: "update", body: JSON.stringify({ ...request, type: "update" }) });
    await processor.processMessage({ key: "delete", body: JSON.stringify({ ...request, type: "delete" }) });
    await assert.rejects(processor.processMessage({
      key: "create", body: JSON.stringify({ ...request, type: "create" }),
    }), failure);
    assert.match(output, /Request bad failed validation.*reason/);
    assert.match(output, /Widget w not found or owner mismatch; update skipped/);
    assert.match(output, /Widget w not found or owner mismatch; delete skipped/);
    assert.match(output, /Request create failed.*storage unavailable/);
    assert.match(output, /"requestId":"r"/);
  } finally {
    logger.remove(transport);
  }
});
