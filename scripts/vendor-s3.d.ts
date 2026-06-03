/**
 * Minimal type declarations for @aws-sdk/client-s3.
 * Full types are available after: pnpm add -D @aws-sdk/client-s3
 * This allows typechecking to pass without the package installed.
 */
declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: Record<string, unknown>);
    send(command: PutObjectCommand): Promise<void>;
  }

  export class PutObjectCommand {
    constructor(input: PutObjectCommandInput);
  }

  interface PutObjectCommandInput {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
    Metadata: Record<string, string>;
  }
}
