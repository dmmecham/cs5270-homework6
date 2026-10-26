import { createInterface } from "node:readline/promises";

import {
    S3Client,
    PutObjectCommand,
    CreateBucketCommand,
    DeleteObjectCommand,
    DeleteBucketCommand,
    ListObjectsV2Command,
    GetObjectCommand,
} from "@aws-sdk/client-s3";

import { Command, Option } from "commander";

import winston from "winston";
import { WidgetRequest, isValidWidgetRequest } from "./Widget.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
  ],
});

const program = new Command();

program
  .name("cs5270-consumer")
  .description("Consumes widget tasks from AWS")
  .version("0.0.1");

program
  .requiredOption("-rb, --request-bucket <bucket>", "Specify the request bucket name", "usu-cs5270-<unique id>-requests")
  .requiredOption("-wb, --web-bucket <bucket>", "Specify the web bucket name", "usu-cs5270-<unique-id>-web")
  .option(new Option("-pi, --polling-interval <ms>", "Specify the polling interval in milliseconds").defaultValue(100, "100 ms"))
  .option("-wt, --widgets-table <name>", "Specify the widgets table name", "widgets");


program.parse();


const s3Client = new S3Client({});

const requestsBucketName = program.opts().requestBucket;
const webBucketName = program.opts().webBucket;
const widgetsTableName = program.opts().widgetsTable || "widgets";

const pollIntervalMs = parseInt(program.opts().pollingInterval) || 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* HW7
async function changeWidget(): Promise<boolean> {
  
}
*/

async function createWidget(widget: WidgetRequest): Promise<boolean> {
  const response = await s3Client.send(new PutObjectCommand({
    Body: JSON.stringify(widget),
    Bucket: webBucketName,
    ContentType: "application/json",
    Key: widget.widgetId,
  }));
  return true;
}

/* HW7
async function deleteWidget(): Promise<boolean> {
  
}
*/

// Reads and removes only the single request with the smallest key.
// S3 lists keys in ascending UTF-8 order, so MaxKeys: 1 gets the smallest.
async function consumeWidget(): Promise<boolean> {
  const list = await s3Client.send(
    new ListObjectsV2Command({ Bucket: requestsBucketName, MaxKeys: 1 }),
  );
  const key = list.Contents?.[0]?.Key;
  if (!key) {
    return false;
  }

  const response = await s3Client.send(new GetObjectCommand({ Bucket: requestsBucketName, Key: key }));
  const body = await response.Body?.transformToString();
  logger.info(`Consumed widget request: ${key}`, { body });

  // Invalid or unsupported requests are dropped so they don't block the queue.
  let request: WidgetRequest | undefined;
  try {
    const parsed: unknown = JSON.parse(body ?? "");
    if (isValidWidgetRequest(parsed)) {
      request = parsed;
    } else {
      logger.warn(`Request ${key} failed validation; discarding`);
    }
  } catch {
    logger.warn(`Request ${key} is not valid JSON; discarding`);
  }

  if (request) {
    if (request.type === "WidgetCreateRequest") {
      await createWidget(request);
    } else {
      logger.warn(`Request ${key} has unsupported type ${request.type}; discarding`);
    }
  }

  await s3Client.send(new DeleteObjectCommand({ Bucket: requestsBucketName, Key: key }));
  return true;
}

async function main() {
  if (!(requestsBucketName && webBucketName)) {
    process.exit()
  }
  logger.info("Starting to consume widget tasks from AWS S3...");

  while (true) {
    let found = false;
    try {
      found = await consumeWidget();
    } catch (error) {
      logger.error(`Error consuming widget task: ${error}`);
    }
    if (!found) {
      await sleep(pollIntervalMs);
    }
  }
}

main().catch((error) => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
