import { describe, expect, it } from 'vitest';
import { responsiveImageSrcset, responsiveImageUrl } from '../src/core/media';

const SUPPORTED = 'https://i.nostr.build/kalIzVhq0xYFPZSA.png';

describe('responsive image delivery', () => {
  it('asks the resizing host for the rendition the surface needs', () => {
    expect(responsiveImageUrl(SUPPORTED, 240)).toBe(`${SUPPORTED}?w=240`);
    expect(responsiveImageUrl(SUPPORTED, 720)).toBe(`${SUPPORTED}?w=720`);
    expect(responsiveImageUrl('https://image.nostr.build/abc.jpg', 360)).toBe('https://image.nostr.build/abc.jpg?w=360');
  });

  it('keeps whatever query the URL already carried', () => {
    const result = responsiveImageUrl(`${SUPPORTED}?foo=bar`, 720);
    expect(result).toContain('foo=bar');
    expect(result).toContain('w=720');
  });

  it('replaces an existing width instead of adding a second one', () => {
    const result = responsiveImageUrl(`${SUPPORTED}?w=1080`, 360);
    expect(result).toBe(`${SUPPORTED}?w=360`);
    expect(result.match(/w=/g)).toHaveLength(1);
  });

  // Exercise photos also arrive from Blossom servers, imported programs and URLs the user
  // typed. A width appended to a host that does not resize is a request for a file that is
  // not there.
  it('leaves a host that does not resize alone', () => {
    expect(responsiveImageUrl('https://external.example/image.jpg', 360)).toBe('https://external.example/image.jpg');
    expect(responsiveImageUrl('https://media.nostr.build/abc.png', 360)).toBe('https://media.nostr.build/abc.png');
    expect(responsiveImageUrl('https://nostr.build/abc.png', 360)).toBe('https://nostr.build/abc.png');
  });

  it('passes through anything that is not a resizable http URL', () => {
    expect(responsiveImageUrl('', 360)).toBe('');
    expect(responsiveImageUrl(undefined, 360)).toBe('');
    expect(responsiveImageUrl('not a url', 360)).toBe('not a url');
    expect(responsiveImageUrl('data:image/png;base64,iVBORw0KGgo=', 360)).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(responsiveImageUrl('blob:https://workstr.fit/9d1c', 360)).toBe('blob:https://workstr.fit/9d1c');
  });

  // The descriptors are the widths the host actually serves, not the ones asked for.
  it('describes each candidate by the width it delivers', () => {
    expect(responsiveImageSrcset(SUPPORTED, [480, 720, 1080])).toBe(
      `${SUPPORTED}?w=480 640w, ${SUPPORTED}?w=720 854w, ${SUPPORTED}?w=1080 1200w`
    );
  });

  it('has nothing to offer for a host that does not resize', () => {
    expect(responsiveImageSrcset('https://external.example/image.jpg', [480, 720])).toBe('');
    expect(responsiveImageSrcset('', [480])).toBe('');
  });
});

// The acceptance criterion that is easy to break later and expensive to notice: a rendition
// URL written into IndexedDB, a Nostr event, a published program or a backup would make the
// stored reference depend on today's CDN. Renditions are a rendering detail, so the layers
// that persist or publish must not be able to build one.
describe('where renditions are allowed to exist', () => {
  const boundaries = ['src/db', 'src/nostr', 'src/sync'];

  it('is nowhere near persistence, publishing or sync', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { resolve, join } = await import('node:path');
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    for (const dir of boundaries) {
      for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true, recursive: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const path = join(entry.parentPath, entry.name);
        const source = readFileSync(path, 'utf8');
        if (/from ['"][^'"]*core\/media['"]/.test(source)) offenders.push(path.replace(`${root}/`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});
