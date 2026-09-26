import { exceedsSignalImageSizeLimit, MAX_IMAGE_BASE64_LENGTH, resolveSignalImageMediaType } from '@/lib/signalImageGuard';

describe('exceedsSignalImageSizeLimit', () => {
  it('is false at and below the limit', () => {
    expect(exceedsSignalImageSizeLimit(MAX_IMAGE_BASE64_LENGTH)).toBe(false);
    expect(exceedsSignalImageSizeLimit(MAX_IMAGE_BASE64_LENGTH - 1)).toBe(false);
    expect(exceedsSignalImageSizeLimit(0)).toBe(false);
  });

  it('is true just over the limit', () => {
    expect(exceedsSignalImageSizeLimit(MAX_IMAGE_BASE64_LENGTH + 1)).toBe(true);
  });
});

describe('resolveSignalImageMediaType', () => {
  it('trusts the picker-reported mimeType when it is a supported one', () => {
    expect(resolveSignalImageMediaType({ mimeType: 'image/png', uri: 'file:///whatever.jpg' })).toBe('image/png');
    expect(resolveSignalImageMediaType({ mimeType: 'image/webp', uri: 'file:///whatever' })).toBe('image/webp');
    expect(resolveSignalImageMediaType({ mimeType: 'image/jpeg', uri: 'file:///whatever' })).toBe('image/jpeg');
  });

  it('falls back to the file extension when mimeType is missing or unsupported', () => {
    expect(resolveSignalImageMediaType({ mimeType: null, uri: 'file:///screenshot.PNG' })).toBe('image/png');
    expect(resolveSignalImageMediaType({ mimeType: undefined, uri: 'file:///screenshot.webp' })).toBe('image/webp');
    expect(resolveSignalImageMediaType({ mimeType: 'application/octet-stream', uri: 'file:///screenshot.png' })).toBe('image/png');
  });

  it('defaults to jpeg when neither mimeType nor extension identifies the format', () => {
    expect(resolveSignalImageMediaType({ mimeType: null, uri: 'file:///screenshot' })).toBe('image/jpeg');
  });
});
