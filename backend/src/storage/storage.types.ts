export interface StorageProvider {
  readonly id: string;
  upload(buffer: Buffer, key: string, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  health(): Promise<'ok' | 'error' | 'not_configured'>;
}
