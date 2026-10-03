import { assert, assertEquals } from 'jsr:@std/assert@1';

import { createAppleClientSecret, readAppleConfig, revokeAppleSignIn, type AppleRevocationConfig } from './apple.ts';

async function makeConfig(): Promise<{ config: AppleRevocationConfig; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let binary = '';
  for (const b of pkcs8) binary += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
  return { config: { teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'com.example.dev', privateKeyPem: pem }, publicKey: pair.publicKey };
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

Deno.test('client secret is a valid ES256 JWT with Apple claims', async () => {
  const { config, publicKey } = await makeConfig();
  const jwt = await createAppleClientSecret(config, 1_000_000);
  const [h, c, s] = jwt.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h!)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c!)));
  assertEquals(header, { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  assertEquals(claims, { iss: 'TEAM123456', iat: 1_000_000, exp: 1_000_300, aud: 'https://appleid.apple.com', sub: 'com.example.dev' });
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64urlToBytes(s!), new TextEncoder().encode(`${h}.${c}`));
  assert(ok);
});

Deno.test('accepts a PEM whose newlines arrived as literal \\n', async () => {
  const { config } = await makeConfig();
  const escaped = { ...config, privateKeyPem: config.privateKeyPem.replace(/\n/g, '\\n') };
  assert((await createAppleClientSecret(escaped)).split('.').length === 3);
});

Deno.test('readAppleConfig needs all four values', () => {
  const env = (values: Record<string, string>) => ({ get: (k: string) => values[k] });
  assertEquals(readAppleConfig(env({})), null);
  assertEquals(readAppleConfig(env({ APPLE_TEAM_ID: 't', APPLE_KEY_ID: 'k', APPLE_CLIENT_ID: 'c' })), null);
  assert(readAppleConfig(env({ APPLE_TEAM_ID: 't', APPLE_KEY_ID: 'k', APPLE_CLIENT_ID: 'c', APPLE_PRIVATE_KEY: 'p' })));
});

Deno.test('exchanges the code then revokes the refresh token', async () => {
  const { config } = await makeConfig();
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetchFn = (url: string, init: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)) });
    return Promise.resolve(
      url.endsWith('/auth/token') ? new Response(JSON.stringify({ refresh_token: 'rt', access_token: 'at' })) : new Response('', { status: 200 }),
    );
  };
  assertEquals(await revokeAppleSignIn('the-code', config, { fetchFn }), 'revoked');
  assertEquals(calls.map((c) => c.url), ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/revoke']);
  assertEquals(calls[0]!.form.get('code'), 'the-code');
  assertEquals(calls[0]!.form.get('grant_type'), 'authorization_code');
  assertEquals(calls[0]!.form.get('client_id'), 'com.example.dev');
  assertEquals(calls[1]!.form.get('token'), 'rt');
  assertEquals(calls[1]!.form.get('token_type_hint'), 'refresh_token');
});

Deno.test('a rejected code is reported as failed and revoke is never called', async () => {
  const { config } = await makeConfig();
  let revokeCalled = false;
  const fetchFn = (url: string) => {
    if (url.endsWith('/auth/revoke')) revokeCalled = true;
    return Promise.resolve(new Response('{"error":"invalid_grant"}', { status: 400 }));
  };
  assertEquals(await revokeAppleSignIn('bad', config, { fetchFn }), 'failed');
  assertEquals(revokeCalled, false);
});

Deno.test('a failing revoke call is reported as failed', async () => {
  const { config } = await makeConfig();
  const fetchFn = (url: string) =>
    Promise.resolve(url.endsWith('/auth/token') ? new Response(JSON.stringify({ refresh_token: 'rt' })) : new Response('', { status: 500 }));
  assertEquals(await revokeAppleSignIn('code', config, { fetchFn }), 'failed');
});

Deno.test('network errors and timeouts never throw', async () => {
  const { config } = await makeConfig();
  assertEquals(await revokeAppleSignIn('c', config, { fetchFn: () => Promise.reject(new Error('offline')) }), 'failed');
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  assertEquals(await revokeAppleSignIn('c', config, { fetchFn: hang, timeoutMs: 20 }), 'failed');
});

Deno.test('a malformed key never throws', async () => {
  assertEquals(
    await revokeAppleSignIn('c', { teamId: 't', keyId: 'k', clientId: 'c', privateKeyPem: 'not a key' }, { fetchFn: () => Promise.reject(new Error('unreached')) }),
    'failed',
  );
});
