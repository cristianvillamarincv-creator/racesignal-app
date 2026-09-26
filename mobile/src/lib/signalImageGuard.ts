/** Mirrors the server-side MAX_IMAGE_BASE64_LENGTH in supabase/functions/signal/index.ts — checked
 *  client-side too so a too-large screenshot is caught before spending a round trip on it. */
export const MAX_IMAGE_BASE64_LENGTH = 6_000_000;

/** True when a picked image's base64 payload exceeds the shared client/server size limit — the
 *  boundary condition signal.tsx's pickImage() gates the "Image too large" alert on. Extracted into
 *  its own pure function (rather than left as an inline comparison) so this exact boundary has
 *  direct regression coverage — see __tests__/signalImageGuard.test.ts. */
export function exceedsSignalImageSizeLimit(base64Length: number): boolean {
  return base64Length > MAX_IMAGE_BASE64_LENGTH;
}

export type SignalImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

/** The picker's own `mimeType` is the real format of the picked asset — never assume JPEG. Physical
 *  testing found a picked screenshot can genuinely be PNG (Anthropic rejected a PNG sent labeled
 *  "image/jpeg"), so this must reflect what the asset actually is, with a safe extension-based
 *  fallback only when the picker doesn't report a (supported) mimeType at all. Takes only the two
 *  fields actually used (not the full `ImagePicker.ImagePickerAsset` type) so this stays a plain,
 *  dependency-free function. */
export function resolveSignalImageMediaType(asset: { mimeType?: string | null; uri: string }): SignalImageMediaType {
  if (asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/png' || asset.mimeType === 'image/webp') {
    return asset.mimeType;
  }
  const uri = asset.uri.toLowerCase();
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
