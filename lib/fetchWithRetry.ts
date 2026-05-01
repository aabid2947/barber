// Network helper: adds a timeout via AbortController and retries *idempotent* reads with
// exponential backoff. Non-GET requests are not auto-retried because a mutation that
// succeeded server-side but lost its response on the way back would be replayed and create
// a duplicate — duplicate prevention is still handled by the pendingActions/busy guards
// in the call sites.

export type FetchErrorKind = 'timeout' | 'network' | 'server' | 'client';

export class FetchError extends Error {
  kind: FetchErrorKind;
  status?: number;
  constructor(kind: FetchErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

interface FetchWithRetryOptions extends RequestInit {
  // Per-attempt timeout. Default 15s — long enough for slow networks, short enough to fail fast.
  timeoutMs?: number;
  // Max retry attempts for GET requests. Default 2 (so up to 3 total attempts). Ignored for mutations.
  maxRetries?: number;
  // Base backoff delay; each retry multiplies by 2. Default 500ms → 500, 1000, 2000.
  backoffMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

const isIdempotent = (method?: string) => {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function fetchWithRetry(input: string, init: FetchWithRetryOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    ...fetchInit
  } = init;

  const method = (fetchInit.method || 'GET').toUpperCase();
  const retriesAllowed = isIdempotent(method) ? maxRetries : 0;

  let lastError: FetchError | null = null;

  for (let attempt = 0; attempt <= retriesAllowed; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(input, { ...fetchInit, signal: controller.signal });
      clearTimeout(timeoutId);

      // 5xx on a GET → retry with backoff; on a mutation, surface to caller.
      if (res.status >= 500 && attempt < retriesAllowed) {
        lastError = new FetchError('server', `Server ${res.status}`, res.status);
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }

      return res;
    } catch (e: any) {
      clearTimeout(timeoutId);

      // AbortError from our timeout is distinct from upstream cancellation.
      const isTimeout = e?.name === 'AbortError';
      lastError = new FetchError(
        isTimeout ? 'timeout' : 'network',
        isTimeout ? `Request timed out after ${timeoutMs}ms` : (e?.message || 'Network error')
      );

      if (attempt < retriesAllowed) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      throw lastError;
    }
  }

  // Exhausted 5xx retries.
  throw lastError ?? new FetchError('network', 'Request failed');
}
