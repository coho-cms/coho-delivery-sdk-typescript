import type { Problem } from './types.ts';

/**
 * A refusal from the delivery API, or an answer the client could not read.
 *
 * Branch on `code`, which is stable. The server's codes include `REF_NOT_FOUND`,
 * `KEY_REQUIRED`, `PROJECT_NOT_FOUND`, `INVALID_QUERY`, `RESOLUTION_LIMIT`,
 * `ARTIFACT_UNREADABLE` and `POOL_UNAVAILABLE`; the last two are the server's
 * problem, not the request's. An answer that is not a problem document, such as a
 * proxy's error page, has the code `UNEXPECTED_RESPONSE`.
 */
export class CohoDeliveryError extends Error {
  readonly status: number;
  readonly code: string;
  /** The problem document as the server sent it, when there was one. */
  readonly problem: Problem | undefined;

  constructor(status: number, code: string, message: string, problem?: Problem) {
    super(message);
    this.name = 'CohoDeliveryError';
    this.status = status;
    this.code = code;
    this.problem = problem;
  }
}
