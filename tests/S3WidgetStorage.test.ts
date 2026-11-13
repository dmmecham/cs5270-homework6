import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand,
  S3Client, type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3WidgetStorage } from "../lib/WidgetStorage.ts";
import { WidgetProcessor } from "../lib/WidgetProcessor.ts";

describe("S3 widget storage", () => {
  const client = new S3Client({});
  const mock = mockClient(client);
  afterEach(() => mock.reset());

  it("writes the complete create request as JSON under the normalized owner key", async () => {
    mock.on(PutObjectCommand).resolves({});
    const request = {
      type: "create",
      requestId: "request-1",
      widgetId: "widget-1",
      owner: "Jane Doe",
      label: "Example",
      otherAttributes: [{ name: "color", value: "blue" }],
    };
    const processor = new WidgetProcessor(new S3WidgetStorage("widgets-bucket", client));
    await processor.processMessage({ key: "request-1", body: JSON.stringify(request) });

    const calls = mock.commandCalls(PutObjectCommand);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[0].input, {
      Bucket: "widgets-bucket",
      Key: "widgets/jane-doe/widget-1",
      Body: JSON.stringify(request),
      ContentType: "application/json",
    });
  });

  it("does not write invalid requests and propagates S3 failures", async () => {
    const processor = new WidgetProcessor(new S3WidgetStorage("widgets-bucket", client));
    const request = { type: "create", requestId: "r", widgetId: "w", owner: "Jane Doe" };
    await processor.processMessage({ key: "invalid", body: "{}" });
    assert.equal(mock.commandCalls(PutObjectCommand).length, 0);

    const error = new Error("S3 unavailable");
    mock.on(PutObjectCommand).rejects(error);
    await assert.rejects(processor.processMessage({
      key: "create",
      body: JSON.stringify({ ...request, type: "create" }),
    }), error);
  });

  it("updates JSON fields and other attributes while preserving identity", async () => {
    const stored = {
      type: "create", requestId: "original", widgetId: "w", owner: "Jane Doe",
      label: "old", description: "unchanged",
      otherAttributes: [{ name: "color", value: "blue" }, { name: "size", value: "small" }],
    };
    mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => JSON.stringify(stored) } as unknown as GetObjectCommandOutput["Body"],
      ETag: '"version"',
    });
    mock.on(PutObjectCommand).resolves({});
    const processor = new WidgetProcessor(new S3WidgetStorage("widgets-bucket", client));
    await processor.processMessage({
      key: "update", body: JSON.stringify({
        type: "update", requestId: "next", widgetId: "w", owner: "Jane Doe",
        label: "", description: null,
        otherAttributes: [
          { name: "color", value: "red" }, { name: "size", value: "" },
          { name: "unchanged", value: null },
        ],
      }),
    });
    const input = mock.commandCalls(PutObjectCommand)[0].args[0].input;
    assert.equal(input.Key, "widgets/jane-doe/w");
    assert.equal(input.IfMatch, '"version"');
    assert.deepEqual(JSON.parse(String(input.Body)), {
      ...stored, label: null, otherAttributes: [{ name: "color", value: "red" }],
    });
  });

  it("handles absent widgets, no-op updates, deletion, and S3 failures", async () => {
    const storage = new S3WidgetStorage("widgets-bucket", client);
    const request = { type: "update" as const, requestId: "r", widgetId: "w", owner: "Jane Doe" };
    const missing = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    mock.on(GetObjectCommand).rejects(missing);
    mock.on(HeadObjectCommand).rejects(Object.assign(new Error("missing"), { name: "NotFound" }));
    assert.equal(await storage.update(request), false);
    assert.equal(await storage.delete(request), false);
    assert.equal(mock.commandCalls(DeleteObjectCommand).length, 0);
    mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => JSON.stringify(request) } as unknown as GetObjectCommandOutput["Body"],
    });
    assert.equal(await storage.update({ ...request, label: null }), true);
    assert.equal(mock.commandCalls(PutObjectCommand).length, 0);
    mock.on(HeadObjectCommand).resolves({});
    mock.on(DeleteObjectCommand).resolves({});
    assert.equal(await storage.delete(request), true);
    assert.deepEqual(mock.commandCalls(DeleteObjectCommand)[0].args[0].input, {
      Bucket: "widgets-bucket", Key: "widgets/jane-doe/w",
    });
    const error = new Error("access denied");
    mock.on(GetObjectCommand).rejects(error);
    await assert.rejects(storage.update(request), error);
  });

  it("does not overwrite malformed or mismatched stored widgets", async () => {
    const storage = new S3WidgetStorage("widgets-bucket", client);
    const request = { type: "update" as const, requestId: "r", widgetId: "w", owner: "Jane Doe", label: "new" };
    for (const body of [
      "{",
      JSON.stringify({ widgetId: "other", owner: "Jane Doe" }),
      JSON.stringify({ widgetId: "w", owner: "Jane Doe", otherAttributes: [{ name: "color" }] }),
    ]) {
      mock.on(GetObjectCommand).resolves({
        Body: { transformToString: async () => body } as unknown as GetObjectCommandOutput["Body"],
      });
      await assert.rejects(storage.update(request));
    }
    assert.equal(mock.commandCalls(PutObjectCommand).length, 0);
  });
});
