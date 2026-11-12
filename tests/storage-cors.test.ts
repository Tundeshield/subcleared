import { describe, expect, it } from 'vitest';
import { mergeCors, storageCorsOrigins } from '../server/storage';

describe('bucket CORS for browser uploads', () => {
  it('allows exactly the app’s own https origins', () => {
    expect(storageCorsOrigins({ APP_URL: 'https://subcleared.io', URL: 'https://subcleared.io', SITE_NAME: 'subcleared' } as any))
      .toEqual(['https://subcleared.io', 'https://www.subcleared.io', 'https://subcleared.netlify.app']);
    expect(storageCorsOrigins({ APP_URL: 'http://localhost:5173' } as any)).toEqual([]);
  });
  it('adds only what is missing and keeps existing rules', () => {
    const origins = ['https://subcleared.io', 'https://subcleared.netlify.app'];
    expect(mergeCors(undefined, origins)).toEqual([{ origin: origins, method: ['PUT', 'GET'], responseHeader: ['Content-Type', 'x-goog-content-length-range'], maxAgeSeconds: 3600 }]);
    const existing = [{ origin: ['https://subcleared.netlify.app'], method: ['PUT', 'GET'], responseHeader: ['Content-Type', 'x-goog-content-length-range'], maxAgeSeconds: 3600 }];
    expect(mergeCors(existing, origins)![1].origin).toEqual(['https://subcleared.io']);
    expect(mergeCors([...existing, { origin: ['https://subcleared.io'], method: ['PUT'], responseHeader: ['content-type', 'x-goog-content-length-range'] }], origins)).toBeNull();
    // A rule without the length-range header would still block the upload.
    expect(mergeCors([{ origin: origins, method: ['PUT'], responseHeader: ['Content-Type'] }], origins)).not.toBeNull();
  });
});
