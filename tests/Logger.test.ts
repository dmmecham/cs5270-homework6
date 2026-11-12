import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { it } from "node:test";
import winston from "winston";
import { logger } from "../lib/logger.ts";

it("formats logs with a timestamp, level, message, and metadata", async () => {
  let output = "";
  const transport = new winston.transports.Stream({
    stream: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
  });
  logger.add(transport);
  try {
    logger.info("test message", { requestId: "r1" });
    assert.match(output, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z info: test message \{"requestId":"r1"\}\r?\n$/);
  } finally {
    logger.remove(transport);
  }
});
