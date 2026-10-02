// Pure environment-consistency checks, shared by app.config.js (config evaluation) and
// src/lib/environment.ts (app startup). No I/O, no secrets: it only inspects values handed to it.
//
// A "development" app must talk ONLY to the racesignal-dev Supabase project and a RevenueCat Test Store
// key; a "production" app must never see either of them. See docs/development-environment.md.

function hostOf(url) {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url || '');
  return match ? match[1].toLowerCase() : null;
}

// Legacy Supabase anon keys are JWTs whose payload carries the owning project ref. Returns that ref, or
// null for non-JWT keys (sb_publishable_...) or anything undecodable.
function projectRefOfKey(key) {
  if (!key || !key.startsWith('eyJ')) return null;
  try {
    const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    // atob exists in Node >= 16 (config evaluation) and in Hermes (app startup).
    const ref = JSON.parse(atob(padded)).ref;
    return typeof ref === 'string' ? ref : null;
  } catch {
    return null;
  }
}

/**
 * @param {{variant: string, supabaseUrl?: string, supabaseAnonKey?: string, revenueCatKey?: string,
 *          devProjectRef: string, requireComplete: boolean}} input
 * @returns {{errors: string[], warnings: string[]}}
 *   errors   -> the caller must refuse to continue.
 *   warnings -> incomplete settings tolerated only when requireComplete is false (a local `eas` CLI config
 *               evaluation has no env files and no EAS variables, so absence there proves nothing).
 */
function evaluateEnvironment({ variant, supabaseUrl, supabaseAnonKey, revenueCatKey, devProjectRef, requireComplete }) {
  const errors = [];
  const warnings = [];
  const devHost = `${devProjectRef}.supabase.co`;
  const urlHost = hostOf(supabaseUrl);
  const keyRef = projectRefOfKey(supabaseAnonKey);

  if (variant === 'development') {
    const missing = [];
    if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    if (!revenueCatKey) missing.push('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY');
    if (missing.length) {
      (requireComplete ? errors : warnings).push(
        `development variant is missing ${missing.join(', ')} (put the racesignal-dev values in mobile/.env.development or the EAS development environment).`,
      );
    }
    if (supabaseUrl && urlHost !== devHost) {
      errors.push(`development variant must use https://${devHost}; EXPO_PUBLIC_SUPABASE_URL points at another host.`);
    }
    if (keyRef !== null && keyRef !== devProjectRef) {
      errors.push('development variant: EXPO_PUBLIC_SUPABASE_ANON_KEY belongs to a different Supabase project than racesignal-dev.');
    }
    if (revenueCatKey && !revenueCatKey.startsWith('test_')) {
      errors.push('development variant must use the RevenueCat dev project Test Store key (test_...), not a production key.');
    }
  } else if (variant === 'production') {
    if (urlHost !== null && (urlHost === devHost || urlHost.startsWith(`${devProjectRef}.`))) {
      errors.push('production variant must not use the racesignal-dev Supabase project.');
    }
    if (keyRef === devProjectRef) {
      errors.push('production variant: EXPO_PUBLIC_SUPABASE_ANON_KEY belongs to the racesignal-dev project.');
    }
    if (revenueCatKey && revenueCatKey.startsWith('test_')) {
      errors.push('production variant must never use a RevenueCat Test Store key (test_...).');
    }
    // Missing production settings are tolerated exactly as before this guard existed (supabaseClient.ts
    // warns and falls back to an unreachable placeholder instead of crashing at launch).
  } else {
    errors.push(`unknown app variant "${variant}" (expected "development" or "production").`);
  }
  return { errors, warnings };
}

module.exports = { evaluateEnvironment, hostOf, projectRefOfKey };
