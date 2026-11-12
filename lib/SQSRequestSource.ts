import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { RequestSource, WidgetMessage } from "./S3RequestSource.ts";

export class SQSRequestSource implements RequestSource {
  readonly acknowledgeAfterProcessing = true;
  private readonly queueName: string;
  private readonly client: SQSClient;
  private queueUrl?: string;
  private readonly pending: WidgetMessage[] = [];

  constructor(queueName: string, client: SQSClient = new SQSClient({})) {
    this.queueName = queueName;
    this.client = client;
  }

  private async getQueueUrl(signal?: AbortSignal): Promise<string> {
    if (!this.queueUrl) {
      const result = await this.client.send(
        new GetQueueUrlCommand({ QueueName: this.queueName }),
        { abortSignal: signal },
      );
      if (!result.QueueUrl) throw new Error(`No URL returned for queue ${this.queueName}`);
      this.queueUrl = result.QueueUrl;
    }
    return this.queueUrl;
  }

  async receiveOne(signal?: AbortSignal): Promise<WidgetMessage | undefined> {
    if (this.pending.length) return this.pending.shift();
    const queueUrl = await this.getQueueUrl(signal);
    const response = await this.client.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10 }),
      { abortSignal: signal },
    );
    const messages = (response.Messages ?? []).map((message) => {
      if (!message.MessageId || !message.ReceiptHandle || message.Body === undefined) {
        throw new Error("SQS returned a message without an ID, receipt handle, or body");
      }
      return {
        key: message.MessageId,
        body: message.Body,
        receiptHandle: message.ReceiptHandle,
      };
    });
    this.pending.push(...messages);
    return this.pending.shift();
  }

  async acknowledge(message: WidgetMessage): Promise<void> {
    if (!message.receiptHandle) {
      throw new Error(`Request ${message.key} is missing its SQS receipt handle`);
    }
    await this.client.send(new DeleteMessageCommand({
      QueueUrl: await this.getQueueUrl(),
      ReceiptHandle: message.receiptHandle,
    }));
  }
}
