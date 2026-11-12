import { logger } from "./logger.ts";
import { isValidWidgetRequest, widgetRequestValidationError } from "./Widget.ts";
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
      logger.warn(`Request ${message.key} failed validation; discarding`, {
        reason: widgetRequestValidationError(request),
      });
      return;
    }

    try {
      switch (request.type) {
        case "WidgetCreateRequest":
        case "create":
          await this.storage.create(request);
          logger.info(`Created widget ${request.widgetId}`, { requestId: request.requestId });
          break;
        case "WidgetUpdateRequest":
        case "update":
          if (await this.storage.update(request)) {
            logger.info(`Updated widget ${request.widgetId}`, { requestId: request.requestId });
          } else {
            logger.warn(`Widget ${request.widgetId} not found or owner mismatch; update skipped`, { requestId: request.requestId });
          }
          break;
        case "WidgetDeleteRequest":
        case "delete":
          if (await this.storage.delete(request)) {
            logger.info(`Deleted widget ${request.widgetId}`, { requestId: request.requestId });
          } else {
            logger.warn(`Widget ${request.widgetId} not found or owner mismatch; delete skipped`, { requestId: request.requestId });
          }
          break;
      }
    } catch (error) {
      logger.error(`Request ${message.key} failed`, {
        requestId: request.requestId,
        type: request.type,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
