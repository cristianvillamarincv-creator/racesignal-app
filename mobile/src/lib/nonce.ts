import * as Crypto from 'expo-crypto';

/**
 * Nonce pair for Sign in with Apple. Apple copies whatever nonce it is given into the identity token;
 * Supabase hashes the RAW nonce it is given with SHA-256 (hex) and compares it to the token's claim. So:
 * give Apple `hashed`, give Supabase `raw`. (Google's free iOS library has no nonce parameter; see
 * socialAuth.ts for how that case is handled.)
 */
export async function createNoncePair(): Promise<{ raw: string; hashed: string }> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  return { raw, hashed };
}
