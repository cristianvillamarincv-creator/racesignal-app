import { assert, assertEquals } from 'jsr:@std/assert@1';

import { checkCustomerPresence, readRevenueCatConfig, requestCustomerDeletion, type FetchFn } from './revenuecat.ts';

const CONFIG = { secretKey: 'sk_test_SECRET_VALUE', projectId: 'proj123' };
const USER = '11111111-2222-3333-4444-555555555555';

function scripted(statuses: (number | 'throw' | 'abort')[]) {
  const calls: { url: string; method: string; auth: string | null }[] = [];
  const fetchFn: FetchFn = (url, init) => {
    calls.push({ url, method: String(init.method), auth: new Headers(init.headers).get('authorization') });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (next === 'throw') return Promise.reject(new TypeError('network down'));
    if (next === 'abort') return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    return Promise.resolve(new Response('{"secret":"must never be read"}', { status: next }));
  };
  return { calls, fetchFn };
}

const fast = { retryDelayMs: 0 };

Deno.test('readRevenueCatConfig needs both values', () => {
  const env = (m: Record<string, string>) => ({ get: (n: string) => m[n] });
  assertEquals(readRevenueCatConfig(env({})), null);
  assertEquals(readRevenueCatConfig(env({ REVENUECAT_SECRET_API_KEY: 'k' })), null);
  assertEquals(readRevenueCatConfig(env({ REVENUECAT_PROJECT_ID: 'p' })), null);
  assertEquals(readRevenueCatConfig(env({ REVENUECAT_SECRET_API_KEY: 'k', REVENUECAT_PROJECT_ID: 'p' })), { secretKey: 'k', projectId: 'p' });
});

Deno.test('delete: exact v2 URL, DELETE method and bearer secret key; 200 means accepted', async () => {
  const { calls, fetchFn } = scripted([200]);
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn, ...fast }), { status: 'accepted' });
  assertEquals(calls, [{ url: `https://api.revenuecat.com/v2/projects/proj123/customers/${USER}`, method: 'DELETE', auth: 'Bearer sk_test_SECRET_VALUE' }]);
});

Deno.test('delete: the id and project are URL-encoded (an anonymous id contains $ and :)', async () => {
  const { calls, fetchFn } = scripted([200]);
  await requestCustomerDeletion('$RCAnonymousID:abc', { secretKey: 'k', projectId: 'p/1' }, { fetchFn, ...fast });
  assertEquals(calls[0]!.url, 'https://api.revenuecat.com/v2/projects/p%2F1/customers/%24RCAnonymousID%3Aabc');
});

Deno.test('delete: 404 is absent (nothing to delete), not a failure', async () => {
  const { calls, fetchFn } = scripted([404]);
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn, ...fast }), { status: 'absent' });
  assertEquals(calls.length, 1);
});

Deno.test('delete: a rejected key or permission is a failure and is not retried', async () => {
  for (const status of [401, 403, 400, 409, 422]) {
    const { calls, fetchFn } = scripted([status]);
    assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn, ...fast }), { status: 'failed', code: `http_${status}` });
    assertEquals(calls.length, 1, `status ${status}`);
  }
});

Deno.test('delete: 429 and 5xx are retried once, and a second success is accepted', async () => {
  for (const first of [429, 500, 503]) {
    const { calls, fetchFn } = scripted([first, 200]);
    assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn, ...fast }), { status: 'accepted' });
    assertEquals(calls.length, 2);
  }
});

Deno.test('delete: still failing after the one retry is a recorded failure', async () => {
  const { calls, fetchFn } = scripted([503, 429]);
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn, ...fast }), { status: 'failed', code: 'http_429' });
  assertEquals(calls.length, 2);
});

Deno.test('delete: network errors and timeouts are failures with safe codes, never thrown', async () => {
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn: scripted(['throw']).fetchFn, ...fast }), { status: 'failed', code: 'network' });
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn: scripted(['abort']).fetchFn, ...fast }), { status: 'failed', code: 'timeout' });
});

Deno.test('delete: a request that never answers is aborted by the timeout', async () => {
  const hang: FetchFn = (_url, init) =>
    new Promise((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  assertEquals(await requestCustomerDeletion(USER, CONFIG, { fetchFn: hang, timeoutMs: 20, retryDelayMs: 0 }), { status: 'failed', code: 'timeout' });
});

Deno.test('lookup: 200 present, 404 absent, anything else unknown with a code', async () => {
  assertEquals(await checkCustomerPresence(USER, CONFIG, { fetchFn: scripted([200]).fetchFn, ...fast }), { presence: 'present' });
  assertEquals(await checkCustomerPresence(USER, CONFIG, { fetchFn: scripted([404]).fetchFn, ...fast }), { presence: 'absent' });
  assertEquals(await checkCustomerPresence(USER, CONFIG, { fetchFn: scripted([401]).fetchFn, ...fast }), { presence: 'unknown', code: 'http_401' });
  assertEquals(await checkCustomerPresence(USER, CONFIG, { fetchFn: scripted(['throw']).fetchFn, ...fast }), { presence: 'unknown', code: 'network' });
});

Deno.test('lookup uses GET (a v2 GET never creates the customer)', async () => {
  const { calls, fetchFn } = scripted([404]);
  await checkCustomerPresence(USER, CONFIG, { fetchFn, ...fast });
  assertEquals(calls[0]!.method, 'GET');
});

Deno.test('the key and response bodies never appear in anything returned', async () => {
  const outcomes = [
    await requestCustomerDeletion(USER, CONFIG, { fetchFn: scripted([401]).fetchFn, ...fast }),
    await checkCustomerPresence(USER, CONFIG, { fetchFn: scripted([500, 500]).fetchFn, ...fast }),
  ];
  const text = JSON.stringify(outcomes);
  assert(!text.includes('SECRET_VALUE') && !text.includes('must never be read'));
});
