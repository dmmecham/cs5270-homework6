import {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { WidgetRequest } from "./Widget.ts";

export interface WidgetStorage {
  create(widget: WidgetRequest): Promise<void>;
  update(widget: WidgetRequest): Promise<boolean>;
  delete(widget: WidgetRequest): Promise<boolean>;
}

function timestamp(now: () => Date): string {
  return now().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function isMissingObject(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return true;
  return "$metadata" in error && typeof error.$metadata === "object" &&
    error.$metadata !== null && "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 404;
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
      if (attribute.value === null) throw new Error("Cannot create a widget with a null attribute value");
      item[attribute.name] = { S: attribute.value };
    }
    Object.assign(item, {
      id: { S: widget.widgetId },
      owner: { S: widget.owner },
      last_modified_on: { S: timestamp(this.now) },
    });
    if (widget.label === null || widget.description === null) {
      throw new Error("Cannot create a widget with a null label or description");
    }
    if (widget.label !== undefined) item.label = { S: widget.label };
    if (widget.description !== undefined) item.description = { S: widget.description };
    await this.client.send(new PutItemCommand({ TableName: this.table, Item: item }));
  }

  async update(widget: WidgetRequest): Promise<boolean> {
    const changes = new Map<string, AttributeValue | undefined>();
    for (const attribute of widget.otherAttributes ?? []) {
      if (attribute.value === null) continue;
      if (["id", "owner", "last_modified_on", "label", "description"].includes(attribute.name)) {
        throw new Error(`Cannot update reserved attribute ${attribute.name} through otherAttributes`);
      }
      changes.set(attribute.name, attribute.value === "" ? undefined : { S: attribute.value });
    }
    for (const name of ["label", "description"] as const) {
      const value = widget[name];
      if (value != null) changes.set(name, value === "" ? { NULL: true } : { S: value });
    }
    if (changes.size === 0) {
      const result = await this.client.send(new GetItemCommand({
        TableName: this.table,
        Key: { id: { S: widget.widgetId } },
        ConsistentRead: true,
        ProjectionExpression: "#owner",
        ExpressionAttributeNames: { "#owner": "owner" },
      }));
      return result.Item?.owner?.S === widget.owner;
    }

    const names: Record<string, string> = { "#id": "id", "#owner": "owner", "#modified": "last_modified_on" };
    const values: Record<string, AttributeValue> = {
      ":owner": { S: widget.owner },
      ":modified": { S: timestamp(this.now) },
    };
    const sets = ["#modified = :modified"];
    const removes: string[] = [];
    let index = 0;
    for (const [name, value] of changes) {
      const key = `#field${index}`;
      names[key] = name;
      if (value === undefined) removes.push(key);
      else {
        const token = `:value${index}`;
        values[token] = value;
        sets.push(`${key} = ${token}`);
      }
      index++;
    }
    try {
      await this.client.send(new UpdateItemCommand({
        TableName: this.table,
        Key: { id: { S: widget.widgetId } },
        ConditionExpression: "attribute_exists(#id) AND #owner = :owner",
        UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async delete(widget: WidgetRequest): Promise<boolean> {
    try {
      await this.client.send(new DeleteItemCommand({
        TableName: this.table,
        Key: { id: { S: widget.widgetId } },
        ConditionExpression: "attribute_exists(#id) AND #owner = :owner",
        ExpressionAttributeNames: { "#id": "id", "#owner": "owner" },
        ExpressionAttributeValues: { ":owner": { S: widget.owner } },
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
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
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(widget),
      Body: JSON.stringify(widget),
      ContentType: "application/json",
    }));
  }

  private key(widget: WidgetRequest): string {
    return `widgets/${widget.owner.toLowerCase().replace(/ /g, "-")}/${widget.widgetId}`;
  }

  async update(widget: WidgetRequest): Promise<boolean> {
    let response;
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(widget) }));
    } catch (error) {
      if (isMissingObject(error)) return false;
      throw error;
    }
    if (!response.Body) throw new Error(`Widget ${widget.widgetId} has no body`);
    const stored: unknown = JSON.parse(await response.Body.transformToString());
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      throw new Error(`Widget ${widget.widgetId} is not a JSON object`);
    }
    const data: Record<string, unknown> = { ...stored };
    if (data.widgetId !== widget.widgetId || data.owner !== widget.owner) {
      throw new Error(`Widget ${widget.widgetId} has a mismatched ID or owner`);
    }
    for (const name of ["label", "description"] as const) {
      const value = widget[name];
      if (value != null) data[name] = value === "" ? null : value;
    }
    const attributes = data.otherAttributes ?? [];
    if (!Array.isArray(attributes) || !attributes.every((attribute: unknown) =>
      typeof attribute === "object" && attribute !== null &&
      "name" in attribute && typeof attribute.name === "string" &&
      "value" in attribute && typeof attribute.value === "string"
    )) {
      throw new Error(`Widget ${widget.widgetId} has invalid otherAttributes`);
    }
    if (widget.label == null && widget.description == null &&
        !(widget.otherAttributes ?? []).some((attribute) => attribute.value !== null)) {
      return true;
    }
    const updated = new Map<string, string>(attributes.map(({ name, value }) => [name, value]));
    for (const attribute of widget.otherAttributes ?? []) {
      if (attribute.value === null) continue;
      if (attribute.value === "") updated.delete(attribute.name);
      else updated.set(attribute.name, attribute.value);
    }
    if (data.otherAttributes !== undefined || widget.otherAttributes != null) {
      data.otherAttributes = [...updated].map(([name, value]) => ({ name, value }));
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(widget),
      Body: JSON.stringify(data),
      ContentType: "application/json",
      ...(response.ETag && { IfMatch: response.ETag }),
    }));
    return true;
  }

  async delete(widget: WidgetRequest): Promise<boolean> {
    const key = this.key(widget);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isMissingObject(error)) return false;
      throw error;
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return true;
  }
}
