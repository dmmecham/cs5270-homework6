import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { SQSRequestSource } from "../lib/SQSRequestSource.ts";
import { consumeRequests } from "../lib/Consumer.ts";
import { WidgetProcessor } from "../lib/WidgetProcessor.ts";

describe("SQSRequestSource", () => {
  const client = new SQSClient({});
  const mock = mockClient(client);
  const queueUrl = "https://sqs.example.test/123/requests";
  afterEach(() => mock.reset());

  it("resolves the queue by name, fetches up to ten messages, and caches the remainder", async () => {
    mock.on(GetQueueUrlCommand).resolves({ QueueUrl: queueUrl });
    mock.on(ReceiveMessageCommand).resolves({
      Messages: [
        { MessageId: "first", ReceiptHandle: "handle-1", Body: "first body" },
        { MessageId: "second", ReceiptHandle: "handle-2", Body: "second body" },
      ],
    });
    const source = new SQSRequestSource("requests", client);
    const signal = new AbortController().signal;
    assert.deepEqual(await source.receiveOne(signal), {
      key: "first", receiptHandle: "handle-1", body: "first body",
    });
    assert.deepEqual(await source.receiveOne(signal), {
      key: "second", receiptHandle: "handle-2", body: "second body",
    });
    assert.deepEqual(mock.commandCalls(GetQueueUrlCommand)[0].args[0].input, { QueueName: "requests" });
    assert.deepEqual(mock.commandCalls(ReceiveMessageCommand)[0].args[0].input, {
      QueueUrl: queueUrl, MaxNumberOfMessages: 10,
    });
    const args: readonly unknown[] = mock.commandCalls(ReceiveMessageCommand)[0].args;
    assert.deepEqual(args[1], { abortSignal: signal });
    assert.equal(mock.commandCalls(ReceiveMessageCommand).length, 1);
    assert.equal(mock.commandCalls(GetQueueUrlCommand).length, 1);
  });

  it("returns no message for an empty queue and deletes using the receipt handle", async () => {
    mock.on(GetQueueUrlCommand).resolves({ QueueUrl: queueUrl });
    mock.on(ReceiveMessageCommand).resolves({});
    mock.on(DeleteMessageCommand).resolves({});
    const source = new SQSRequestSource("requests", client);
    assert.equal(await source.receiveOne(), undefined);
    await source.acknowledge({ key: "id", body: "{}", receiptHandle: "receipt" });
    assert.deepEqual(mock.commandCalls(DeleteMessageCommand)[0].args[0].input, {
      QueueUrl: queueUrl, ReceiptHandle: "receipt",
    });
    await assert.rejects(source.acknowledge({ key: "id", body: "{}" }), /receipt handle/);
  });

  it("surfaces queue lookup, malformed message, and delete errors", async () => {
    const source = new SQSRequestSource("requests", client);
    mock.on(GetQueueUrlCommand).resolves({});
    await assert.rejects(source.receiveOne(), /No URL returned/);
    mock.on(GetQueueUrlCommand).resolves({ QueueUrl: queueUrl });
    mock.on(ReceiveMessageCommand).resolves({ Messages: [{ MessageId: "id", Body: "{}" }] });
    await assert.rejects(source.receiveOne(), /receipt handle/);
    const error = new Error("delete failed");
    mock.on(DeleteMessageCommand).rejects(error);
    await assert.rejects(source.acknowledge({ key: "id", body: "{}", receiptHandle: "r" }), error);
  });

  it("processes a batch of create, update, delete, and invalid requests before deleting each message", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    mock.on(GetQueueUrlCommand).resolves({ QueueUrl: queueUrl });
    mock.on(ReceiveMessageCommand).resolves({
      Messages: ["create", "update", "delete", "bad"].map((type, index) => ({
        MessageId: `m${index}`,
        ReceiptHandle: `h${index}`,
        Body: JSON.stringify({ type, requestId: `r${index}`, widgetId: "w", owner: "Jane Doe" }),
      })),
    });
    mock.on(DeleteMessageCommand).callsFake(async ({ ReceiptHandle }) => {
      events.push(`ack:${ReceiptHandle}`);
      if (ReceiptHandle === "h3") controller.abort();
      return {};
    });
    const processor = new WidgetProcessor({
      async create() { events.push("create"); },
      async update() { events.push("update"); return true; },
      async delete() { events.push("delete"); return true; },
    });
    await consumeRequests(new SQSRequestSource("requests", client), processor, 100, controller.signal);
    assert.deepEqual(events, ["create", "ack:h0", "update", "ack:h1", "delete", "ack:h2", "ack:h3"]);
    assert.equal(mock.commandCalls(ReceiveMessageCommand).length, 1);
  });
});
