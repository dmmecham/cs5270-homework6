import {
  DynamoDBClient,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { logger } from "./logger.js";
import {
  isValidWidgetRequest,
  type WidgetRequest,
} from "./Widget.js";
import type { WidgetMessage } from "./S3RequestSource.js";

export class WidgetProcessor {
  constructor(
    private readonly widgetsTable: string,
    private readonly dynamoDbClient: DynamoDBClient = new DynamoDBClient({}),
  ) {}

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
    Object.assign(item, {
      type: { S: widget.type },
      requestId: { S: widget.requestId },
      widgetId: { S: widget.widgetId },
      owner: { S: widget.owner },
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
