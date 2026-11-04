import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', ...rest } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile, ...rest }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

// A JSON call with the same-origin header the server requires and an optional workspace.
export async function call(url, method, path, body, { ws = 'default', headers = {}, raw } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', origin: url, 'x-workspace': ws, ...headers } };
  if (raw !== undefined) init.body = raw; else if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`${url}${path}`, init);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, text, json };
}
