import { describe, expect, it } from 'vitest';
import { renderManifest, toPosixPath } from './asset-manifest.ts';

describe('toPosixPath', () => {
  it('rewrites Windows separators', () => {
    expect(toPosixPath('assets\\index-abc.js', '\\')).toBe('assets/index-abc.js');
  });

  it('leaves a POSIX path alone', () => {
    expect(toPosixPath('assets/index-abc.js', '/')).toBe('assets/index-abc.js');
  });

  it('handles a nested path and a bare filename', () => {
    expect(toPosixPath('a\\b\\c.png', '\\')).toBe('a/b/c.png');
    expect(toPosixPath('index.html', '\\')).toBe('index.html');
  });
});

describe('renderManifest', () => {
  const manifest = renderManifest(['index.html', 'assets/index-abc.js']);

  it('imports each file and keys it by URL pathname', () => {
    expect(manifest).toContain("import a0 from '../../dist/index.html' with { type: 'file' };");
    expect(manifest).toContain("import a1 from '../../dist/assets/index-abc.js' with { type: 'file' };");
    expect(manifest).toContain("  '/index.html': a0,");
    expect(manifest).toContain("  '/assets/index-abc.js': a1,");
  });

  // The regression this module exists for: a backslash anywhere in the output
  // is either a broken escape in an import specifier or a key no request can
  // match. Neither fails a build — the app just serves 404s.
  it('never emits a backslash', () => {
    const fromWindows = ['assets\\index-abc.js', 'fonts\\a\\b.woff2'].map((p) =>
      toPosixPath(p, '\\'),
    );
    expect(renderManifest(fromWindows)).not.toContain('\\');
  });

  it('renders an empty map when dist/ has nothing', () => {
    expect(renderManifest([])).toContain('export const ASSET_MANIFEST: Record<string, string> = {');
    expect(renderManifest([])).not.toContain('import a0');
  });
});
