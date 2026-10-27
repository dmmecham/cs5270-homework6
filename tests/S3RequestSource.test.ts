import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { S3RequestSource } from "../lib/S3RequestSource.js";

describe("S3RequestSource", () => {
  const mocks: ReturnType<typeof mockClient>[] = [];

  afterEach(() => {
    for (const mock of mocks.splice(0)) {
      mock.restore();
    }
  });

  it("retrieves only the first listed request and returns its body", async () => {
    const client = new S3Client({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "request-001" }, { Key: "request-002" }],
      $metadata: {},
    });
    mock.on(GetObjectCommand).resolves({
      Body: {
        transformToString: async () => '{"type":"WidgetCreateRequest"}',
      } as unknown as GetObjectCommandOutput["Body"],
      $metadata: {},
    });

    const source = new S3RequestSource("requests", client);
    const message = await source.receiveOne();

    assert.deepEqual(message, {
      key: "request-001",
      body: '{"type":"WidgetCreateRequest"}',
    });
    assert.deepEqual(mock.commandCalls(ListObjectsV2Command)[0].args[0].input, {
      Bucket: "requests",
      MaxKeys: 1,
    });
    assert.equal(mock.commandCalls(GetObjectCommand).length, 1);
    assert.equal(mock.commandCalls(GetObjectCommand)[0].args[0].input.Key, "request-001");
  });

  it("returns undefined without reading when the bucket is empty", async () => {
    const client = new S3Client({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(ListObjectsV2Command).resolves({ Contents: [], $metadata: {} });

    const source = new S3RequestSource("requests", client);
    assert.equal(await source.receiveOne(), undefined);
    assert.equal(mock.commandCalls(GetObjectCommand).length, 0);
  });

  it("returns an empty body when the object has none", async () => {
    const client = new S3Client({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "request-001" }],
      $metadata: {},
    });
    mock.on(GetObjectCommand).resolves({ $metadata: {} });

    const source = new S3RequestSource("requests", client);
    assert.deepEqual(await source.receiveOne(), { key: "request-001", body: "" });
  });

  it("acknowledges a received request by deleting its S3 object", async () => {
    const client = new S3Client({});
    const mock = mockClient(client);
    mocks.push(mock);
    mock.on(DeleteObjectCommand).resolves({ $metadata: {} });

    const source = new S3RequestSource("requests", client);
    await source.acknowledge({ key: "request-001", body: "{}" });

    assert.deepEqual(mock.commandCalls(DeleteObjectCommand)[0].args[0].input, {
      Bucket: "requests",
      Key: "request-001",
    });
  });

  it("propagates S3 errors", async () => {
    const client = new S3Client({});
    const mock = mockClient(client);
    mocks.push(mock);
    const error = new Error("S3 unavailable");
    mock.on(ListObjectsV2Command).rejects(error);

    const source = new S3RequestSource("requests", client);
    await assert.rejects(source.receiveOne(), error);
  });
});
