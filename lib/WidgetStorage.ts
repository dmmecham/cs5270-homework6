import {
  DynamoDBClient,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { WidgetRequest } from "./Widget.ts";

export interface WidgetStorage {
  create(widget: WidgetRequest): Promise<void>;
}

export class DynamoDBWidgetStorage implements WidgetStorage {
  private readonly table: string;
  private readonly client: DynamoDBClient;
  private readonly now: () => Date;

  constructor(
    table: string,
    client: DynamoDBClient = new DynamoDBClient({}),
    now: () => Date = () => new Date(),
  ) {
    this.table = table;
    this.client = client;
    this.now = now;
  }

  async create(widget: WidgetRequest): Promise<void> {
    const item: Record<string, AttributeValue> = Object.create(null);
    for (const attribute of widget.otherAttributes ?? []) {
      item[attribute.name] = { S: attribute.value };
    }
    Object.assign(item, {
      id: { S: widget.widgetId },
      owner: { S: widget.owner },
      last_modified_on: { S: this.now().toISOString().replace(/\.\d{3}Z$/, "Z") },
    });
    if (widget.label !== undefined) item.label = { S: widget.label };
    if (widget.description !== undefined) item.description = { S: widget.description };
    await this.client.send(new PutItemCommand({ TableName: this.table, Item: item }));
  }
}

export class S3WidgetStorage implements WidgetStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(bucket: string, client: S3Client = new S3Client({})) {
    this.bucket = bucket;
    this.client = client;
  }

  async create(widget: WidgetRequest): Promise<void> {
    const owner = widget.owner.toLowerCase().replace(/ /g, "-");
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `widgets/${owner}/${widget.widgetId}`,
      Body: JSON.stringify(widget),
      ContentType: "application/json",
    }));
  }
}
