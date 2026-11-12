import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

  it("does not write invalid or unsupported requests and propagates S3 failures", async () => {
    const processor = new WidgetProcessor(new S3WidgetStorage("widgets-bucket", client));
    const request = { type: "update", requestId: "r", widgetId: "w", owner: "Jane Doe" };
    await processor.processMessage({ key: "update", body: JSON.stringify(request) });
    await processor.processMessage({ key: "invalid", body: "{}" });
    assert.equal(mock.commandCalls(PutObjectCommand).length, 0);

    const error = new Error("S3 unavailable");
    mock.on(PutObjectCommand).rejects(error);
    await assert.rejects(processor.processMessage({
      key: "create",
      body: JSON.stringify({ ...request, type: "create" }),
    }), error);
  });
});
