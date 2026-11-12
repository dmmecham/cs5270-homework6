import { Command, InvalidArgumentError } from "commander";
import { addLogFile, logger } from "./lib/logger.ts";
import { S3RequestSource } from "./lib/S3RequestSource.ts";
import type { RequestSource } from "./lib/S3RequestSource.ts";
import { SQSRequestSource } from "./lib/SQSRequestSource.ts";
import { WidgetProcessor } from "./lib/WidgetProcessor.ts";
import { DynamoDBWidgetStorage, S3WidgetStorage } from "./lib/WidgetStorage.ts";
import { consumeRequests } from "./lib/Consumer.ts";

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
  .option("-r, --request-bucket <bucket>", "S3 bucket containing requests")
  .option("-q, --request-queue <name>", "SQS queue containing requests")
  .option("-s, --storage <type>", "Widget storage: dynamodb or s3", "dynamodb")
  .option("-t, --widgets-table <name>", "DynamoDB widgets table", "widgets")
  .option("-b, --widget-bucket <bucket>", "S3 bucket for stored widgets")
  .option(
    "-p, --polling-interval <ms>",
    "Polling interval in milliseconds",
    parsePollingInterval,
    100,
  )
  .option("-l, --log-file <path>", "File to write logs to (in addition to the console)");
program.parse();

const options = program.opts<{
  requestBucket?: string;
  requestQueue?: string;
  storage: string;
  widgetsTable: string;
  widgetBucket?: string;
  pollingInterval: number;
  logFile?: string;
}>();
if (!!options.requestBucket === !!options.requestQueue) {
  program.error("Specify exactly one of --request-bucket or --request-queue");
}
if (options.storage !== "dynamodb" && options.storage !== "s3") {
  program.error("--storage must be dynamodb or s3");
}
if (options.storage === "s3") {
  if (!options.widgetBucket) program.error("--widget-bucket is required for S3 storage");
  if (options.widgetBucket === options.requestBucket) {
    program.error("--widget-bucket must differ from --request-bucket");
  }
  if (program.getOptionValueSource("widgetsTable") === "cli") {
    program.error("--widgets-table cannot be used with S3 storage");
  }
} else if (options.widgetBucket !== undefined) {
  program.error("--widget-bucket requires --storage s3");
}
if (options.logFile !== undefined) {
  addLogFile(options.logFile);
}

async function main(): Promise<void> {
  let requestSource: RequestSource;
  if (options.requestQueue) requestSource = new SQSRequestSource(options.requestQueue);
  else if (options.requestBucket) requestSource = new S3RequestSource(options.requestBucket);
  else throw new Error("No request source specified");
  const storage = options.storage === "s3" && options.widgetBucket !== undefined
    ? new S3WidgetStorage(options.widgetBucket)
    : new DynamoDBWidgetStorage(options.widgetsTable);
  const widgetProcessor = new WidgetProcessor(storage);
  const controller = new AbortController();
  const stop = () => {
    if (!controller.signal.aborted) {
      logger.info("Stopping after the current request...");
      controller.abort();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  logger.info(`Starting to consume widget tasks from ${options.requestQueue ? "SQS" : "S3"}...`);

  try {
    await consumeRequests(requestSource, widgetProcessor, options.pollingInterval, controller.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  logger.info("Consumer stopped");
}

main().catch((error: unknown) => {
  logger.error("Unhandled error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
