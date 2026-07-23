export class AdapterError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class UpstreamError extends AdapterError {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    public readonly upstreamBody?: Uint8Array,
    public readonly upstreamContentType?: string,
  ) {
    super(statusCode, code, message);
    this.name = 'UpstreamError';
  }
}
