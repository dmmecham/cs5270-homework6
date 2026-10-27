# CS5270 Widget Consumer

A Node.js/TypeScript consumer that handles widget requests. Each request is deleted from the bucket, validated against [widgetRequest-schema.json](./widgetRequest-schema.json), and processed. Widgets are stored as items in a DynamoDB table. Delete and update requests are logged and discarded.

Currently only `WidgetCreateRequest` is supported.

For the S3 source, it polls an S3 bucket and processes each item one at a time in key order. 

## Prerequisites

- [Node.js](https://nodejs.org/) 22.18 or newer (includes npm). Check with `node --version`. This is the minimum to run the TypeScript code without a separate compilation step.
- An AWS account with:
  - an S3 bucket that holds the widget request JSON files, and
  - a DynamoDB table whose partition key is the string attribute `widgetId`.
- AWS credentials and region available to the AWS SDK, for example via `aws configure`, or the environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, (optionally `AWS_SESSION_TOKEN`) and `AWS_REGION`.
  The credentials need `s3:ListBucket`, `s3:GetObject`, `s3:DeleteObject` on the request bucket and `dynamodb:PutItem` on the table.

## Setup

```
npm ci
```

`npm ci` installs the exact versions from `package-lock.json`.

## Running

```
node index.ts --request-bucket <bucket> [--widgets-table <name>] [--polling-interval <ms>]
```

### Arguments

| Option | Short | Required | Default | Description |
|---|---|---|---|---|
| `--request-bucket <bucket>` | `-r` | Yes | none | S3 bucket to read widget requests from. |
| `--widgets-table <name>` | `-t` | No | `widgets` | DynamoDB table that widgets are stored in. |
| `--polling-interval <ms>` | `-p` | No | `100` | Milliseconds to wait before polling again when the bucket is empty or an error occurs. Must be a positive integer. |
| `--version` | `-V` | No | | Print the version and exit. |
| `--help` | `-h` | No | | Show usage and exit. |

Most options can be combined freely and in any order. For S3, `--request-bucket` is required.

### Examples

Minimal (default table `widgets`, 100 ms polling):

```powershell
node index.ts -r my-request-bucket
```

Custom DynamoDB table:

```powershell
node index.ts --request-bucket my-request-bucket --widgets-table my-widgets
```

Slower polling (1 second):

```powershell
node index.ts -r my-request-bucket -p 1000
```

All options:

```powershell
node index.ts -r my-request-bucket -t my-widgets -p 250
```

Specify a region/profile for a single run:

```powershell
$env:AWS_REGION = "us-east-1"; $env:AWS_PROFILE = "default"; node index.ts -r my-request-bucket
```

A missing `--request-bucket`, or a non-positive/non-numeric `--polling-interval`, prints an error and exits.

## Request format

Each S3 object must contain JSON matching [widgetRequest-schema.json](./widgetRequest-schema.json), for example:

```json
{
  "type": "WidgetCreateRequest",
  "requestId": "6a8e2f3c-0001",
  "widgetId": "widget-001",
  "owner": "Mary Matthews",
  "label": "Sample widget",
  "description": "A sample widget",
  "otherAttributes": [
    { "name": "color", "value": "blue" }
  ]
}
```

Invalid JSON or requests that fail validation are logged and discarded (they are still removed from the bucket).

The stored DynamoDB item has the flat attributes `type`, `requestId`, `widgetId`, `owner`, optional `label` and `description`, and one string attribute per `otherAttributes` entry.

## Logging

Logs go to the console and to `consumer.log` in the directory the program is started from.

## Tests

```powershell
npm test
```

Unit tests use mocked AWS clients, so no AWS access is needed. Type-check with `npx tsc --project tsconfig.json`.

## Project layout

- [index.ts](./index.ts): command-line arguments and the polling loop.
- [lib/S3RequestSource.ts](./lib/S3RequestSource.ts): retrieves and acknowledges (deletes) requests from S3 behind the `RequestSource` interface, so another source can be swapped in.
- [lib/Widget.ts](./lib/Widget.ts): widget types and request validation.
- [lib/WidgetProcessor.ts](./lib/WidgetProcessor.ts): processes requests and stores widgets in DynamoDB.
- [tests/](./tests): unit tests.
