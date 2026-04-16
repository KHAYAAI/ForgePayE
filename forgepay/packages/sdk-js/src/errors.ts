/**
 * ForgePay SDK error hierarchy.
 * Follows a similar pattern to the Stripe Node SDK for familiarity.
 */

export class ForgePayError extends Error {
  readonly code:       string;
  readonly statusCode: number;
  readonly requestId:  string | undefined;

  constructor(message: string, code: string, statusCode: number, requestId?: string) {
    super(message);
    this.name       = 'ForgePayError';
    this.code       = code;
    this.statusCode = statusCode;
    this.requestId  = requestId;
  }
}

export class AuthenticationError extends ForgePayError {
  constructor(message = 'Invalid API key', requestId?: string) {
    super(message, 'authentication_error', 401, requestId);
    this.name = 'AuthenticationError';
  }
}

export class InvalidRequestError extends ForgePayError {
  readonly param: string | undefined;
  constructor(message: string, param?: string, requestId?: string) {
    super(message, 'invalid_request', 400, requestId);
    this.name  = 'InvalidRequestError';
    this.param = param;
  }
}

export class RateLimitError extends ForgePayError {
  constructor(message = 'Too many requests', requestId?: string) {
    super(message, 'rate_limit_error', 429, requestId);
    this.name = 'RateLimitError';
  }
}

export class ApiError extends ForgePayError {
  constructor(message: string, statusCode: number, requestId?: string) {
    super(message, 'api_error', statusCode, requestId);
    this.name = 'ApiError';
  }
}

export class IdempotencyError extends ForgePayError {
  constructor(message: string, requestId?: string) {
    super(message, 'idempotency_error', 422, requestId);
    this.name = 'IdempotencyError';
  }
}
