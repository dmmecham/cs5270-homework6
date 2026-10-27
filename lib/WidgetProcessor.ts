import {
  DynamoDBClient,
  PutItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import winston from "winston";
import {
  isValidWidgetRequest,
  type WidgetRequest,
} from "./Widget.js";
import type { WidgetMessage } from "./S3RequestSource.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "consumer.log" }),
  ],
});

export class WidgetProcessor {
  private readonly dynamoDbClient = new DynamoDBClient({});

  constructor(private readonly widgetsTable: string) {}

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
        logger.warn(
          `Request ${message.key} has unsupported type ${request.type}; discarding`,
        );
        break;
    }
  }

  private async createWidget(widget: WidgetRequest): Promise<void> {
    const item = Object.assign(Object.create(null), {
      type: { S: widget.type },
      requestId: { S: widget.requestId },
      widgetId: { S: widget.widgetId },
      owner: { S: widget.owner },
    }) as Record<string, AttributeValue>;
    if (widget.label !== undefined) {
      item.label = { S: widget.label };
    }
    if (widget.description !== undefined) {
      item.description = { S: widget.description };
    }
    for (const attribute of widget.otherAttributes ?? []) {
      item[attribute.name] = { S: attribute.value };
    }

    await this.dynamoDbClient.send(
      new PutItemCommand({
        TableName: this.widgetsTable,
        Item: item,
      }),
    );
  }
}
