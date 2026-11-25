import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assistantImageForAnalysis } from './assistantImage.service';
describe('HEIF analysis derivative', () => {
  it('does not alter already supported original image bytes', async () => {
    const original = Buffer.from('synthetic'); const result = await assistantImageForAnalysis(original, 'image/png');
    expect(result.buffer).toBe(original); expect(result.mimeType).toBe('image/png');
  });
  it('rejects corrupt HEIC without returning successful extraction', async () => {
    await expect(assistantImageForAnalysis(Buffer.from('invalid'), 'image/heic')).rejects.toThrow(/HEIC|HEIF/);
  });
  it.skipIf(!process.env.QA_SYNTHETIC_HEIC)('decodes real synthetic HEIC bytes in a worker and preserves the source', async () => {
    const original = readFileSync(process.env.QA_SYNTHETIC_HEIC!); const before = Buffer.from(original);
    const result = await assistantImageForAnalysis(original, 'image/heic');
    expect(result.mimeType).toBe('image/jpeg'); expect(result.buffer.subarray(0,3)).toEqual(Buffer.from([255,216,255]));
    expect(original).toEqual(before); expect(result.buffer.length).toBeGreaterThan(1000);
  }, 40000);
});
