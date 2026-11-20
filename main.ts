// Builds the competition entry: copies the static app/ (and screenshots/) next to this file into
// MAKEFUN_OUTPUT_DIR (default /output), then has the vendored make.fun library hash the result and
// write dossier.json beside them. Standard library only, so `node main.ts` is the whole build.
//
// Layout produced:
//   $MAKEFUN_OUTPUT_DIR/app/...
//   $MAKEFUN_OUTPUT_DIR/screenshots/...
//   $MAKEFUN_OUTPUT_DIR/dossier.json
//
// The three caps below mirror the scorer's gate: a dossier over them would be refused anyway.

import { copyFileSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
};

const sourceRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Recursive copy without relying on cpSync's option surface: directories are created first, files
// land after their parent exists. Missing sources are skipped so screenshots/ may be absent.
function mirror(from: string, to: string): void {
  let info;
  try {
    info = lstatSync(from);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) mirror(join(from, entry), join(to, entry));
    return;
  }
  if (!info.isFile()) return;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

mkdirSync(outputRoot, { recursive: true });
mirror(join(sourceRoot, 'app'), join(outputRoot, 'app'));
mkdirSync(join(outputRoot, 'screenshots'), { recursive: true });
mirror(join(sourceRoot, 'screenshots'), join(outputRoot, 'screenshots'));

writeFileSync(join(outputRoot, 'dossier.json'), buildDossier(outputRoot, CAPS));
