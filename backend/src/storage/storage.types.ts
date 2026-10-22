export type StorageObjectMetadata = {
  key: string;
  size: number;
  updatedAt?: Date;
  etag?: string;
  contentType?: string;
};

export type StorageListPage = {
  items: StorageObjectMetadata[];
  nextCursor?: string;
};

export interface StorageProvider {
  readonly id: string;
  readonly capabilities: {
    head: boolean;
    copy: boolean;
    list: boolean;
    resumable: boolean;
    multipart: boolean;
  };
  upload(buffer: Buffer, key: string, mimeType: string): Promise<string>;
  /** Upload a bounded local worker spool without materializing the object in RAM. */
  uploadFile?(filename: string, key: string, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  /** Download into a bounded local worker spool without materializing the object in RAM. */
  downloadFile?(key: string, filename: string): Promise<void>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<StorageObjectMetadata | null>;
  copy(sourceKey: string, destinationKey: string): Promise<string>;
  list(prefix: string, cursor?: string, limit?: number): Promise<StorageListPage>;
  health(): Promise<'ok' | 'error' | 'not_configured'>;
}
