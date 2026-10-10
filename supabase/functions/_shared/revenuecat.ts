// RevenueCat customer deletion for account deletion.
//
// Deleting a RaceSignal account must also remove the account's RevenueCat customer record (RevenueCat is our subscription provider
// and holds the account id, purchase status and basic device metadata). RevenueCat's delete call is ASYNCHRONOUS: a 200 only means
// "queued", so an accepted request stays pending until a later lookup returns "not found". Nothing in this file may ever block or
// fail the account deletion: every problem comes back as a plain status.
//
// API (RevenueCat REST v2): DELETE and GET /v2/projects/{project_id}/customers/{customer_id}, authorized by a SECRET key that is
// limited to the `customer_information:customers:read_write` permission. 404 on delete means the customer does not exist.

export interface RevenueCatConfig {
  secretKey: string;
  projectId: string;
}

export function readRevenueCatConfig(env: { get(name: string): string | undefined }): RevenueCatConfig | null {
  const secretKey = env.get('REVENUECAT_SECRET_API_KEY');
  const projectId = env.get('REVENUECAT_PROJECT_ID');
  if (!secretKey || !projectId) return null;
  return { secretKey, projectId };
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface CallOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const BASE_URL = 'https://api.revenuecat.com/v2';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAY_MS = 500;

function customerUrl(userId: string, config: RevenueCatConfig): string {
  return `${BASE_URL}/projects/${encodeURIComponent(config.projectId)}/customers/${encodeURIComponent(userId)}`;
}

/** A short, safe code for a failed call: never a response body, never a key. */
type CallResult = { kind: 'response'; status: number } | { kind: 'error'; code: 'timeout' | 'network' };

async function call(method: 'GET' | 'DELETE', userId: string, config: RevenueCatConfig, options: CallOptions): Promise<CallResult> {
  const fetchFn = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchFn(customerUrl(userId, config), {
      method,
      headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    // The body is never read or kept; only the status matters.
    await response.body?.cancel().catch(() => {});
    return { kind: 'response', status: response.status };
  } catch (err) {
    return { kind: 'error', code: (err as Error)?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(result: CallResult): boolean {
  return result.kind === 'error' || result.status === 429 || result.status >= 500;
}

async function callWithOneRetry(method: 'GET' | 'DELETE', userId: string, config: RevenueCatConfig, options: CallOptions): Promise<CallResult> {
  const first = await call(method, userId, config, options);
  if (!isRetryable(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  return await call(method, userId, config, options);
}

function codeOf(result: CallResult): string {
  return result.kind === 'error' ? result.code : `http_${result.status}`;
}

export type DeletionRequestOutcome =
  | { status: 'accepted' } // RevenueCat queued the deletion; the customer may still exist for a while
  | { status: 'absent' } // RevenueCat has no such customer (404): nothing to delete
  | { status: 'failed'; code: string };

/** Asks RevenueCat to delete the customer. One retry on a network error, timeout, 429 or 5xx. Never throws. */
export async function requestCustomerDeletion(userId: string, config: RevenueCatConfig, options: CallOptions = {}): Promise<DeletionRequestOutcome> {
  const result = await callWithOneRetry('DELETE', userId, config, options);
  if (result.kind === 'response') {
    if (result.status === 200) return { status: 'accepted' };
    if (result.status === 404) return { status: 'absent' };
  }
  return { status: 'failed', code: codeOf(result) };
}

export type CustomerPresence = { presence: 'present' } | { presence: 'absent' } | { presence: 'unknown'; code: string };

/** Looks the customer up WITHOUT creating it (a v2 GET never creates). 404 is the only proof of removal. Never throws. */
export async function checkCustomerPresence(userId: string, config: RevenueCatConfig, options: CallOptions = {}): Promise<CustomerPresence> {
  const result = await callWithOneRetry('GET', userId, config, options);
  if (result.kind === 'response') {
    if (result.status === 200) return { presence: 'present' };
    if (result.status === 404) return { presence: 'absent' };
  }
  return { presence: 'unknown', code: codeOf(result) };
}
