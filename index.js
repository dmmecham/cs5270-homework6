import { createInterface } from "node:readline/promises";

import {
    S3Client,
    PutObjectCommand,
    CreateBucketCommand,
    DeleteObjectCommand,
    DeleteBucketCommand,
    paginateListObjectsV2,
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
  .command("consume")
  .description("Consume widget tasks from AWS")
  .action(async () => {
    await main();
  });


program.parse();


const s3Client = new S3Client({});

const bucketName = "widget-tasks";
