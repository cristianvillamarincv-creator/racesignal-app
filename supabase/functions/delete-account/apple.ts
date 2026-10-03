// Sign in with Apple token revocation for account deletion.
//
// Apple requires an app that offers Sign in with Apple to revoke the user's tokens through the REST API
// when the account is deleted. The flow needs a short-lived client secret (an ES256 JWT signed with the
// team's Sign in with Apple key) and a single-use authorization code the app obtains by asking Apple for a
// fresh sign-in at deletion time. Apple's own guidance is that when the code is unavailable, deletion must
// still go ahead: nothing here is allowed to block it, so every failure mode returns a plain status.

export interface AppleRevocationConfig {
  teamId: string;
  keyId: string;
  /** The app's bundle ID for native sign-in (the dev project and production project each set their own). */
  clientId: string;
  privateKeyPem: string;
}

export type AppleRevocationStatus = 'revoked' | 'failed' | 'not_attempted';

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const TOKEN_URL = `${APPLE_AUDIENCE}/auth/token`;
const REVOKE_URL = `${APPLE_AUDIENCE}/auth/revoke`;

export function readAppleConfig(env: { get(name: string): string | undefined }): AppleRevocationConfig | null {
  const teamId = env.get('APPLE_TEAM_ID');
  const keyId = env.get('APPLE_KEY_ID');
  const clientId = env.get('APPLE_CLIENT_ID');
  const privateKeyPem = env.get('APPLE_PRIVATE_KEY');
  if (!teamId || !keyId || !clientId || !privateKeyPem) return null;
  return { teamId, keyId, clientId, privateKeyPem };
}

function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = '';
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  // Secrets set from a shell often arrive with literal "\n" sequences instead of newlines.
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized.replace(/-----BEGIN [A-Z ]+-----/, '').replace(/-----END [A-Z ]+-----/, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function createAppleClientSecret(config: AppleRevocationConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const claims = { iss: config.teamId, iat: nowSeconds, exp: nowSeconds + 300, aud: APPLE_AUDIENCE, sub: config.clientId };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(config.privateKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the raw r||s form that JWS ES256 expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${base64Url(signature)}`;
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchanges the single-use authorization code for a refresh token, then revokes it. Never throws: any
 * problem (bad code, Apple outage, timeout, a malformed key) is reported as 'failed' so the caller can
 * carry on deleting the account.
 */
export async function revokeAppleSignIn(
  authorizationCode: string,
  config: AppleRevocationConfig,
  options: { fetchFn?: FetchFn; timeoutMs?: number; nowSeconds?: number } = {},
): Promise<'revoked' | 'failed'> {
  const fetchFn = options.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 6000;
  try {
    const clientSecret = await createAppleClientSecret(config, options.nowSeconds);
    const tokenResponse = await postForm(
      fetchFn,
      TOKEN_URL,
      { client_id: config.clientId, client_secret: clientSecret, code: authorizationCode, grant_type: 'authorization_code' },
      timeoutMs,
    );
    if (!tokenResponse.ok) {
      console.warn('[delete-account] Apple token exchange rejected, status', tokenResponse.status);
      return 'failed';
    }
    const tokens = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string };
    const token = tokens.refresh_token ?? tokens.access_token;
    if (!token) return 'failed';
    const revokeResponse = await postForm(
      fetchFn,
      REVOKE_URL,
      {
        client_id: config.clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
      },
      timeoutMs,
    );
    if (!revokeResponse.ok) {
      console.warn('[delete-account] Apple revoke rejected, status', revokeResponse.status);
      return 'failed';
    }
    return 'revoked';
  } catch (err) {
    console.warn('[delete-account] Apple revocation did not complete:', (err as Error)?.name ?? 'error');
    return 'failed';
  }
}
