export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  get isRetryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}
