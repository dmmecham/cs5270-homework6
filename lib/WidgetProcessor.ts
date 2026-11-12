import { logger } from "./logger.ts";
import { isValidWidgetRequest } from "./Widget.ts";
import type { WidgetMessage } from "./S3RequestSource.ts";
import type { WidgetStorage } from "./WidgetStorage.ts";

export class WidgetProcessor {
  private readonly storage: WidgetStorage;

  constructor(storage: WidgetStorage) {
    this.storage = storage;
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
        await this.storage.create(request);
        logger.info(`Created widget ${request.widgetId}`, {
          requestId: request.requestId,
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

}
