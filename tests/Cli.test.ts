import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

it("rejects invalid storage choices and incompatible resource arguments", () => {
  const cases = [
    { args: ["--storage", "other"], error: /--storage must be dynamodb or s3/ },
    { args: ["--storage", "s3"], error: /--widget-bucket is required/ },
    { args: ["--widget-bucket", "widgets"], error: /--widget-bucket requires --storage s3/ },
    { args: ["--storage", "s3", "--widget-bucket", "requests"], error: /must differ/ },
    { args: ["--storage", "s3", "--widget-bucket", "widgets", "--widgets-table", "table"], error: /cannot be used/ },
  ];
  for (const { args, error } of cases) {
    const result = spawnSync(process.execPath, ["index.ts", "-r", "requests", ...args], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, error);
  }
});

it("requires exactly one request source", () => {
  for (const args of [[], ["-r", "requests", "-q", "queue"]]) {
    const result = spawnSync(process.execPath, ["index.ts", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly one of --request-bucket or --request-queue/);
  }
});

it("processes and acknowledges an SQS request with either storage strategy", () => {
  const script = `
    import { SQSClient, GetQueueUrlCommand, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
    import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
    import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
    import { mockClient } from "aws-sdk-client-mock";
    const events = [];
    const queue = mockClient(SQSClient);
    queue.on(GetQueueUrlCommand).callsFake(async ({ QueueName }) => {
      events.push("queue:" + QueueName); return { QueueUrl: "queue-url" };
    });
    let received = false;
    queue.on(ReceiveMessageCommand).callsFake(async ({ MaxNumberOfMessages }) => {
      if (received) return { Messages: [] };
      received = true;
      events.push("receive:" + MaxNumberOfMessages);
      return { Messages: [{ MessageId: "message", ReceiptHandle: "receipt",
        Body: JSON.stringify({ type: "create", requestId: "r", widgetId: "w", owner: "Jane Doe" }) }] };
    });
    queue.on(DeleteMessageCommand).callsFake(async ({ ReceiptHandle }) => {
      events.push("delete:" + ReceiptHandle);
      setTimeout(() => process.emit("SIGINT"), 10);
      return {};
    });
    mockClient(DynamoDBClient).on(PutItemCommand).callsFake(async ({ Item }) => {
      events.push("dynamodb:" + Item.id.S); return {};
    });
    mockClient(S3Client).on(PutObjectCommand).callsFake(async ({ Key }) => {
      events.push("s3:" + Key); return {};
    });
    process.argv = [process.execPath, "-q", "my-queue", ...JSON.parse(process.env.TEST_ARGS)];
    process.on("beforeExit", () => console.log("TRACE " + JSON.stringify(events)));
    await import("./index.ts");
  `;
  const cases = [
    { args: [], storage: "dynamodb:w" },
    { args: ["--storage", "s3", "-b", "widgets"], storage: "s3:widgets/jane-doe/w" },
  ];
  for (const { args, storage } of cases) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, TEST_ARGS: JSON.stringify(args) }, timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`TRACE ${JSON.stringify([
      "queue:my-queue", "receive:10", storage, "delete:receipt",
    ])}`), result.stdout);
  }
});

it("handles SIGINT and writes timestamped logs to a file only when requested", () => {
  const dir = mkdtempSync(join(tmpdir(), "widget-consumer-"));
  const logFile = join(dir, "consumer.log");
  const script = `
    import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
    import { mockClient } from "aws-sdk-client-mock";
    const mock = mockClient(S3Client);
    mock.on(ListObjectsV2Command).callsFake(async () => {
      setTimeout(() => process.emit("SIGINT"), 10);
      return { Contents: [] };
    });
    process.argv = [process.execPath, "-r", "requests", ...JSON.parse(process.env.TEST_ARGS)];
    await import("./index.ts");
  `;
  try {
    for (const args of [[], ["--log-file", logFile]]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        env: { ...process.env, TEST_ARGS: JSON.stringify(args) },
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\d{4}-\d\d-\d\dT.*Z info: Consumer stopped/);
      if (args.length === 0) {
        assert.deepEqual(readdirSync(dir), []);
      } else {
        assert.match(readFileSync(logFile, "utf8"), /\d{4}-\d\d-\d\dT.*Z info: Consumer stopped/);
      }
    }
  } finally {
    rmSync(logFile, { force: true });
    rmdirSync(dir);
  }
});
