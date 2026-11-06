import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Provide a port from 1 to 65535, for example: npm start -- 4174');
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = path === '/' ? 'index.html' : path.slice(1);
    const segments = relative.split('/');
    if (segments.some((part) => !part || part.startsWith('.') || part.includes('\\'))
      || (relative !== 'index.html' && !['src', 'models', 'data', 'assets'].includes(segments[0]))) {
      response.writeHead(404).end('File not found.');
      return;
    }
    const file = await realpath(resolve(root, relative));
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(404).end('File not found.');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const missing = ['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code);
    response.writeHead(missing ? 404 : 400).end(missing ? 'File not found.' : 'Could not read the requested file.');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is in use. Try npm start -- ${port === 65535 ? 4173 : port + 1}`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`BNA Airfield Model Starter: http://127.0.0.1:${port}`));
