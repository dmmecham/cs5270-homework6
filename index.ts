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

import { Command } from "commander";

import winston from "winston";

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
  .option("--request-bucket, -rb <bucket>", "Specify the request bucket name")
  .option("--web-bucket, -wb <bucket>", "Specify the web bucket name")
  .option("--polling-interval, -pi <ms>", "Specify the polling interval in milliseconds")
  .option("--widgets-table, -wt <name>", "Specify the widgets table name")


program.parse();


const s3Client = new S3Client({});

const bucketName = program.opts().requestBucket || "widget-tasks";
const webBucketName = program.opts().webBucket || "widget-web";
const widgetsTableName = program.opts().widgetsTable || "widgets";

const pollIntervalMs = parseInt(program.opts().pollingInterval) || 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reads and removes only the single request with the smallest key.
// S3 lists keys in ascending UTF-8 order, so MaxKeys: 1 yields the smallest.
async function consumeOne(): Promise<boolean> {
  const list = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 }),
  );
  const key = list.Contents?.[0]?.Key;
  if (!key) {
    return false;
  }

  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const body = await response.Body?.transformToString();
  logger.info(`Consumed widget request: ${key}`, { body });

  await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  return true;
}

async function main() {
  logger.info("Starting to consume widget tasks from AWS S3...");

  while (true) {
    let found = false;
    try {
      found = await consumeOne();
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
