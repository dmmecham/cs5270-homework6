import {
  DynamoDBClient,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { logger } from "./logger.ts";
import {
  isValidWidgetRequest,
  type WidgetRequest,
} from "./Widget.ts";
import type { WidgetMessage } from "./S3RequestSource.ts";

export class WidgetProcessor {
  private readonly widgetsTable: string;
  private readonly dynamoDbClient: DynamoDBClient;
  private readonly now: () => Date;

  constructor(
    widgetsTable: string,
    dynamoDbClient: DynamoDBClient = new DynamoDBClient({}),
    now: () => Date = () => new Date(),
  ) {
    this.widgetsTable = widgetsTable;
    this.dynamoDbClient = dynamoDbClient;
    this.now = now;
  }

  async processMessage(message: WidgetMessage): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(message.body);
    } catch {
      logger.warn(`Request ${message.key} is not valid JSON; discarding`);
      return;
    }

    if (!isValidWidgetRequest(request)) {
      logger.warn(`Request ${message.key} failed validation; discarding`);
      return;
    }

    switch (request.type) {
      case "WidgetCreateRequest":
      case "create":
        await this.createWidget(request);
        logger.info(`Created widget ${request.widgetId}`, {
          requestId: request.requestId,
          table: this.widgetsTable,
        });
        break;
      case "WidgetDeleteRequest":
      case "WidgetUpdateRequest":
      default:
        logger.warn(
          `Request ${message.key} has unsupported type ${request.type}; discarding`,
        );
        break;
    }
  }

  private async createWidget(widget: WidgetRequest): Promise<void> {
    const item = Object.create(null) as Record<string, AttributeValue>;
    for (const attribute of widget.otherAttributes ?? []) {
      item[attribute.name] = { S: attribute.value };
    }
    // Set last so an otherAttribute can never overwrite a core widget field.
    // Matches the layout of existing items in the widgets table. The "owner"
    // index uses last_modified_on (ISO UTC, no milliseconds) as its sort key.
    Object.assign(item, {
      id: { S: widget.widgetId },
      owner: { S: widget.owner },
      last_modified_on: { S: this.now().toISOString().replace(/\.\d{3}Z$/, "Z") },
    });
    if (widget.label !== undefined) {
      item.label = { S: widget.label };
    }
    if (widget.description !== undefined) {
      item.description = { S: widget.description };
    }

    await this.dynamoDbClient.send(
      new PutItemCommand({
        TableName: this.widgetsTable,
        Item: item,
      }),
    );
  }
}
