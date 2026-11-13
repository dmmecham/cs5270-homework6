import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBWidgetStorage } from "../lib/WidgetStorage.ts";
import { WidgetProcessor } from "../lib/WidgetProcessor.ts";

describe("DynamoDB widget updates and deletes", () => {
  const client = new DynamoDBClient({});
  const mock = mockClient(client);
  const processor = new WidgetProcessor(new DynamoDBWidgetStorage(
    "widgets", client, () => new Date("2026-01-02T03:04:05.000Z"),
  ));
  const base = { requestId: "r", widgetId: "w", owner: "Jane Doe" };
  afterEach(() => mock.reset());

  it("updates requested fields, removes empty other attributes, and leaves null fields alone", async () => {
    mock.on(UpdateItemCommand).resolves({});
    await processor.processMessage({
      key: "request",
      body: JSON.stringify({
        ...base,
        type: "update",
        label: "",
        description: null,
        otherAttributes: [
          { name: "color", value: "red" },
          { name: "size", value: "" },
          { name: "untouched", value: null },
        ],
      }),
    });
    const calls = mock.commandCalls(UpdateItemCommand);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[0].input, {
      TableName: "widgets",
      Key: { id: { S: "w" } },
      ConditionExpression: "attribute_exists(#id) AND #owner = :owner",
      UpdateExpression: "SET #modified = :modified, #field0 = :value0, #field2 = :value2 REMOVE #field1",
      ExpressionAttributeNames: {
        "#id": "id", "#owner": "owner", "#modified": "last_modified_on",
        "#field0": "color", "#field1": "size", "#field2": "label",
      },
      ExpressionAttributeValues: {
        ":owner": { S: "Jane Doe" }, ":modified": { S: "2026-01-02T03:04:05Z" },
        ":value0": { S: "red" }, ":value2": { NULL: true },
      },
    });
  });

  it("checks existence without modifying an update containing only null values", async () => {
    mock.on(GetItemCommand).resolves({ Item: { owner: { S: "Jane Doe" } } });
    const storage = new DynamoDBWidgetStorage("widgets", client);
    assert.equal(await storage.update({ ...base, type: "update", label: null }), true);
    assert.equal(mock.commandCalls(UpdateItemCommand).length, 0);
    mock.on(GetItemCommand).resolves({ Item: { owner: { S: "Someone Else" } } });
    assert.equal(await storage.update({ ...base, type: "update" }), false);
  });

  it("returns false for missing or owner-mismatched items and propagates other failures", async () => {
    const missing = Object.assign(new Error("not found"), { name: "ConditionalCheckFailedException" });
    mock.on(UpdateItemCommand).rejects(missing);
    mock.on(DeleteItemCommand).rejects(missing);
    const storage = new DynamoDBWidgetStorage("widgets", client);
    assert.equal(await storage.update({ ...base, type: "update", label: "new" }), false);
    assert.equal(await storage.delete({ ...base, type: "delete" }), false);
    const error = new Error("DynamoDB unavailable");
    mock.on(DeleteItemCommand).rejects(error);
    await assert.rejects(storage.delete({ ...base, type: "delete" }), error);
  });

  it("conditionally deletes by ID and owner", async () => {
    mock.on(DeleteItemCommand).resolves({});
    const storage = new DynamoDBWidgetStorage("widgets", client);
    assert.equal(await storage.delete({ ...base, type: "delete" }), true);
    assert.deepEqual(mock.commandCalls(DeleteItemCommand)[0].args[0].input, {
      TableName: "widgets",
      Key: { id: { S: "w" } },
      ConditionExpression: "attribute_exists(#id) AND #owner = :owner",
      ExpressionAttributeNames: { "#id": "id", "#owner": "owner" },
      ExpressionAttributeValues: { ":owner": { S: "Jane Doe" } },
    });
  });

  it("rejects attempts to update reserved fields through otherAttributes", async () => {
    const storage = new DynamoDBWidgetStorage("widgets", client);
    await assert.rejects(storage.update({
      ...base, type: "update", otherAttributes: [{ name: "owner", value: "Other" }],
    }), /reserved attribute owner/);
    assert.equal(mock.commandCalls(UpdateItemCommand).length, 0);
  });

  it("propagates update errors and refuses null create attributes", async () => {
    const error = new Error("update unavailable");
    mock.on(UpdateItemCommand).rejects(error);
    const storage = new DynamoDBWidgetStorage("widgets", client);
    await assert.rejects(storage.update({ ...base, type: "update", label: "new" }), error);
    await assert.rejects(storage.create({
      ...base, type: "create", otherAttributes: [{ name: "color", value: null }],
    }), /null attribute/);
  });
});
