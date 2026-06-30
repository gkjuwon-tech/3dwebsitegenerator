// Copy three.js Draco + Basis(KTX2) decoders into public/ so the runtime can
// decode compressed GLBs without depending on a third-party CDN.
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

function threeLibs() {
  // three restricts ./package.json in its exports map; resolve the main module
  // (.../three/build/three.module.js) and walk up to the package root instead.
  const main = require.resolve('three');
  const root = dirname(dirname(main)); // build/ → three/
  return join(root, 'examples', 'jsm', 'libs');
}

async function main() {
  const libs = threeLibs();
  const out = join(process.cwd(), 'public', 'decoders');
  const jobs = [
    [join(libs, 'draco'), join(out, 'draco')],
    [join(libs, 'basis'), join(out, 'basis')],
  ];
  for (const [src, dst] of jobs) {
    if (!existsSync(src)) {
      console.warn(`[copy-decoders] missing ${src} — skipping`);
      continue;
    }
    await mkdir(dst, { recursive: true });
    await cp(src, dst, { recursive: true });
    console.log(`[copy-decoders] ${src} → ${dst}`);
  }
}

main().catch((e) => {
  console.error('[copy-decoders] failed:', e);
  process.exit(0); // non-fatal: uncompressed GLBs still load
});
