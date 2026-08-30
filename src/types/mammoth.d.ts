declare module "mammoth" {
  export interface RawTextResult {
    value: string;
    messages: unknown[];
  }

  export interface ExtractRawTextOptions {
    buffer: Buffer;
  }

  export function extractRawText(
    options: ExtractRawTextOptions,
  ): Promise<RawTextResult>;
}
