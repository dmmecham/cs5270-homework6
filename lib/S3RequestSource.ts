import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

export interface WidgetMessage {
  key: string;
  body: string;
}

export interface RequestSource {
  receiveOne(): Promise<WidgetMessage | undefined>;
  acknowledge(message: WidgetMessage): Promise<void>;
}

export class S3RequestSource implements RequestSource {
  private readonly requestBucket: string;
  private readonly s3Client: S3Client;

  constructor(requestBucket: string, s3Client: S3Client = new S3Client({})) {
    this.requestBucket = requestBucket;
    this.s3Client = s3Client;
  }

  async receiveOne(): Promise<WidgetMessage | undefined> {
    const list = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.requestBucket,
        MaxKeys: 1,
      }),
    );
    const key = list.Contents?.[0]?.Key;
    if (!key) {
      return undefined;
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.requestBucket, Key: key }),
    );
    const body = await response.Body?.transformToString();
    return { key, body: body ?? "" };
  }

  async acknowledge(message: WidgetMessage): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.requestBucket,
        Key: message.key,
      }),
    );
  }
}
