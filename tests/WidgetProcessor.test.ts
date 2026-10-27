import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { WidgetProcessor } from "../lib/WidgetProcessor.ts";

describe("WidgetProcessor", () => {
  const mocks: ReturnType<typeof mockClient>[] = [];

  afterEach(() => {
    for (const mock of mocks.splice(0)) {
      mock.restore();
    }
  });

  it("stores a create request in DynamoDB with flattened widget attributes", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(PutItemCommand).resolves({ $metadata: {} });

    const processor = new WidgetProcessor(
      "widgets",
      client,
      () => new Date("2026-09-25T18:05:23.456Z"),
    );
    await processor.processMessage({
      key: "request-001",
      body: JSON.stringify({
        type: "WidgetCreateRequest",
        requestId: "request-001",
        widgetId: "widget-001",
        owner: "Jane Doe",
        label: "Example",
        description: "A widget",
        otherAttributes: [
          { name: "color", value: "blue" },
          { name: "size", value: "large" },
        ],
      }),
    });

    const calls = mock.commandCalls(PutItemCommand);
    assert.equal(calls.length, 1);
    const input = calls[0].args[0].input;
    assert.deepEqual({
      TableName: input.TableName,
      Item: Object.fromEntries(Object.entries(input.Item ?? {})),
    }, {
      TableName: "widgets",
      Item: {
        id: { S: "widget-001" },
        owner: { S: "Jane Doe" },
        last_modified_on: { S: "2026-09-25T18:05:23Z" },
        label: { S: "Example" },
        description: { S: "A widget" },
        color: { S: "blue" },
        size: { S: "large" },
      },
    });
  });

  it("does not let otherAttributes overwrite core widget fields", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(PutItemCommand).resolves({ $metadata: {} });

    const processor = new WidgetProcessor("widgets", client);
    await processor.processMessage({
      key: "request-002",
      body: JSON.stringify({
        type: "WidgetCreateRequest",
        requestId: "request-002",
        widgetId: "widget-002",
        owner: "Jane Doe",
        otherAttributes: [
          { name: "id", value: "hijacked" },
          { name: "owner", value: "Someone Else" },
          { name: "last_modified_on", value: "yesterday" },
        ],
      }),
    });

    const item = mock.commandCalls(PutItemCommand)[0].args[0].input.Item;
    assert.deepEqual(item?.id, { S: "widget-002" });
    assert.deepEqual(item?.owner, { S: "Jane Doe" });
    assert.match(item?.last_modified_on?.S ?? "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(item?.label, undefined);
  });

  it("does not write invalid JSON or requests rejected by the schema", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    const processor = new WidgetProcessor("widgets", client);

    await processor.processMessage({ key: "bad-json", body: "{" });
    await processor.processMessage({
      key: "bad-request",
      body: JSON.stringify({ type: "remove" }),
    });

    assert.equal(mock.commandCalls(PutItemCommand).length, 0);
  });

  it("discards update and delete requests until those actions are supported", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    const processor = new WidgetProcessor("widgets", client);

    for (const type of ["WidgetDeleteRequest", "WidgetUpdateRequest"]) {
      await processor.processMessage({
        key: `${type}-request`,
        body: JSON.stringify({
          type,
          requestId: `${type}-request`,
          widgetId: "widget-001",
          owner: "Jane Doe",
        }),
      });
    }

    assert.equal(mock.commandCalls(PutItemCommand).length, 0);
  });

  it("discards requests with malformed trailing otherAttributes", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    const processor = new WidgetProcessor("widgets", client);

    await processor.processMessage({
      key: "malformed-attributes",
      body: JSON.stringify({
        type: "WidgetCreateRequest",
        requestId: "request-001",
        widgetId: "widget-001",
        owner: "Jane Doe",
        otherAttributes: [
          { name: "color", value: "blue" },
          { name: 7 },
        ],
      }),
    });

    assert.equal(mock.commandCalls(PutItemCommand).length, 0);
  });

  it("propagates DynamoDB write failures", async () => {
    const client = new DynamoDBClient({});
    const mock = mockClient(client);
    mocks.push(mock);
    const error = new Error("DynamoDB unavailable");
    mock.on(PutItemCommand).rejects(error);
    const processor = new WidgetProcessor("widgets", client);

    await assert.rejects(
      processor.processMessage({
        key: "request-001",
        body: JSON.stringify({
          type: "WidgetCreateRequest",
          requestId: "request-001",
          widgetId: "widget-001",
          owner: "Jane Doe",
        }),
      }),
      error,
    );
  });
});
