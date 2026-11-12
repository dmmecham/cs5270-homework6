# CS5270 Widget Consumer

A Node.js/TypeScript consumer that handles widget requests. Each request is deleted from the bucket, validated against [widgetRequest-schema.json](./widgetRequest-schema.json), and processed. Widgets are stored in DynamoDB by default or in a separate S3 bucket. Delete and update requests are logged and discarded.

Currently only `WidgetCreateRequest` is supported.

For the S3 source, it polls an S3 bucket and processes each item one at a time in key order. 

## Prerequisites

- [Node.js](https://nodejs.org/) 22.18 or newer (includes npm). Check with `node --version`. This is the minimum to run the TypeScript code without a separate compilation step.
- An AWS account with:
  - an S3 bucket that holds the widget request JSON files, and either
  - a DynamoDB table whose partition key is the string attribute `id` (set from the request's `widgetId`), or
  - a separate S3 bucket for stored widgets.
- AWS credentials and region available to the AWS SDK, for example via `aws configure`, or the environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, (optionally `AWS_SESSION_TOKEN`) and `AWS_REGION`.
  The credentials need `s3:ListBucket`, `s3:GetObject`, and `s3:DeleteObject` on the request bucket, plus `dynamodb:PutItem` on the table or `s3:PutObject` on the widget bucket, depending on storage.

## Setup

```
npm ci
```

`npm ci` installs the exact versions from `package-lock.json`.

## Running

```
node index.ts --request-bucket <bucket> [--storage <dynamodb|s3>] [--widgets-table <name> | --widget-bucket <bucket>] [--polling-interval <ms>] [--log-file <path>]
```

### Arguments

| Option | Short | Required | Default | Description |
|---|---|---|---|---|
| `--request-bucket <bucket>` | `-r` | Yes | none | S3 bucket to read widget requests from. |
| `--storage <type>` | `-s` | No | `dynamodb` | Widget storage strategy: `dynamodb` or `s3`. |
| `--widgets-table <name>` | `-t` | No | `widgets` | DynamoDB table that widgets are stored in. |
| `--widget-bucket <bucket>` | `-b` | For S3 storage | none | Separate S3 bucket in which to store widgets. |
| `--polling-interval <ms>` | `-p` | No | `100` | Milliseconds to wait before polling again when the bucket is empty or an error occurs. Must be a positive integer. |
| `--log-file <path>` | `-l` | No | none | File to write logs to, in addition to the console. No log file is written unless this is given. Appended to if it already exists. |
| `--version` | `-V` | No | | Print the version and exit. |
| `--help` | `-h` | No | | Show usage and exit. |

`--request-bucket` is always required. For S3 storage, specify `--storage s3` and `--widget-bucket`; the widget bucket must differ from the request bucket. `--widgets-table` is only valid with DynamoDB storage.

### Examples

Minimal (default table `widgets`, 100 ms polling):

```powershell
node index.ts -r my-request-bucket
```

Custom DynamoDB table:

```powershell
node index.ts --request-bucket my-request-bucket --widgets-table my-widgets
```

S3 widget storage:

```powershell
node index.ts -r my-request-bucket --storage s3 --widget-bucket my-widget-bucket
```

Slower polling (1 second):

```powershell
node index.ts -r my-request-bucket -p 1000
```

All options:

```powershell
node index.ts -r my-request-bucket -t my-widgets -p 250 -l logs/run1.log
```

Log to a specific file:

```powershell
node index.ts -r my-request-bucket --log-file consumer-test1.log
```

Specify a region/profile for a single run:

```powershell
$env:AWS_REGION = "us-east-1"; $env:AWS_PROFILE = "default"; node index.ts -r my-request-bucket
```

A missing `--request-bucket`, or a non-positive/non-numeric `--polling-interval`, prints an error and exits.
The consumer exits after 30 seconds without a request, measured from startup or after the last request finishes processing. Failed reads do not reset this timeout. Press Ctrl-C to stop sooner. In either case, the consumer finishes processing an already acknowledged request before exiting; a request read but not yet acknowledged is left in the bucket.

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

The stored DynamoDB item has the flat attributes `id` (the request's `widgetId`), `owner`, `last_modified_on` (UTC timestamp), optional `label` and `description`, and one string attribute per `otherAttributes` entry. With S3 storage, the complete create request is stored as JSON at `widgets/{owner}/{widgetId}`, with spaces in the owner replaced by dashes and letters lowercased.

Requests are deleted before processing, as required by the assignment; a subsequent storage failure is logged but the request is not retried.

## Logging

Logs always go to the console. They are also written to a file only when `--log-file` is given. Each line contains a UTC timestamp, level, message, and any structured metadata.

## Tests

```powershell
npm test
```

Unit tests use mocked AWS clients, so no AWS access is needed. Type-check with `npx tsc --project tsconfig.json`.

## Project layout

- [index.ts](./index.ts): command-line arguments, storage selection, and signal handling.
- [lib/Consumer.ts](./lib/Consumer.ts): polling loop.
- [lib/S3RequestSource.ts](./lib/S3RequestSource.ts): retrieves and acknowledges (deletes) requests from S3 behind the `RequestSource` interface, so another source can be swapped in.
- [lib/Widget.ts](./lib/Widget.ts): widget types and request validation.
- [lib/WidgetProcessor.ts](./lib/WidgetProcessor.ts): validates and processes requests.
- [lib/WidgetStorage.ts](./lib/WidgetStorage.ts): DynamoDB and S3 widget storage.
- [tests/](./tests): unit tests.
