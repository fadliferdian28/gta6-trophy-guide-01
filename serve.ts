// Development-only static server for app/. `node serve.ts` listens on 127.0.0.1:8080; pass
// `--port 3000` (or any 1-65535 value) to move it. Only files inside app/ are reachable: the
// requested path is decoded, resolved, and rejected if it escapes the app root.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('./app', import.meta.url)));

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function requestedPort(argv: string[]): number {
  const at = argv.indexOf('--port');
  if (at < 0) return 8080;
  const value = Number(argv[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return 8080;
  return value;
}

function reply(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function insideApp(candidate: string): boolean {
  const rel = relative(APP_ROOT, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

const port = requestedPort(process.argv.slice(2));

createServer((request: IncomingMessage, response: ServerResponse) => {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }

  const rawUrl = request.url ?? '/';
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch {
    reply(response, 400, 'bad request');
    return;
  }

  let file = resolve(join(APP_ROOT, pathname));
  if (!insideApp(file) && file !== APP_ROOT) {
    reply(response, 403, 'forbidden');
    return;
  }

  let stats;
  try {
    stats = statSync(file);
    if (stats.isDirectory()) {
      file = join(file, 'index.html');
      stats = statSync(file);
    }
    if (!stats.isFile()) throw new Error('not a regular file');
  } catch {
    reply(response, 404, 'not found');
    return;
  }

  const headers: Record<string, string | number> = {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': 'no-cache',
  };
  response.writeHead(200, headers);
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).on('error', () => response.destroy()).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving app/ at http://127.0.0.1:${port}`);
});
