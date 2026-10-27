import { Command, InvalidArgumentError } from "commander";
import { logger } from "./lib/logger.js";
import { S3RequestSource } from "./lib/S3RequestSource.js";
import { WidgetProcessor } from "./lib/WidgetProcessor.js";

function parsePollingInterval(value: string): number {
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return interval;
}

const program = new Command();
program
  .name("cs5270-consumer")
  .description("Consumes widget tasks from AWS")
  .version("0.0.1")
  .requiredOption("-r, --request-bucket <bucket>", "S3 bucket containing requests")
  .option("-t, --widgets-table <name>", "DynamoDB widgets table", "widgets")
  .option(
    "-p, --polling-interval <ms>",
    "Polling interval in milliseconds",
    parsePollingInterval,
    100,
  );
program.parse();

const options = program.opts<{
  requestBucket: string;
  widgetsTable: string;
  pollingInterval: number;
}>();

const pollIntervalMs = options.pollingInterval;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const requestSource = new S3RequestSource(options.requestBucket);
  const widgetProcessor = new WidgetProcessor(options.widgetsTable);
  logger.info("Starting to consume widget tasks from AWS S3...");

  while (true) {
    try {
      const message = await requestSource.receiveOne();
      if (!message) {
        await sleep(pollIntervalMs);
        continue;
      }

      await requestSource.acknowledge(message);
      await widgetProcessor.processMessage(message);
    } catch (error) {
      logger.error("Error consuming widget task", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(pollIntervalMs);
    }
  }
}

main().catch((error: unknown) => {
  logger.error("Unhandled error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
