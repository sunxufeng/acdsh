'use strict';
/*
 * dsh-feishu-auth — Feishu (Lark) OAuth login gate in front of DeepSeek Harness (DSH).
 *
 * Pure Node.js stdlib, no external dependencies (avoids native builds / OOM).
 *   - GET  /login            -> HTML page with "Login with Feishu" button
 *   - GET  /feishu/authorize -> sets CSRF state cookie, 302 to Feishu authorize URL
 *   - GET  /feishu/callback  -> exchanges code for token + user info, sets session, 302 to /
 *   - GET  /logout           -> clears session, 302 to /login
 *   - *                      -> requires valid session; else 302 to /login; if ok, proxy to DSH
 *
 * The Feishu app_secret never leaves the server. Session ids are 32-byte random,
 * stored in an in-memory map (cleared on restart -> users re-login, acceptable).
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.DSH_FEISHU_CONFIG || path.join(__dirname, 'config.json');
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Safety net: never let a single bad request / dropped connection crash the process.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', (e && e.stack) || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e && e.stack) || e));

// --- session store ---------------------------------------------------------
const sessions = new Map(); // sid -> { open_id, name, email, expires }
const SESSION_TTL = (CONFIG.sessionTtlSeconds || 86400) * 1000;
const SESSION_COOKIE = 'dsh_sid';
const STATE_COOKIE = 'dsh_oauth_state';

function newId(n) { return crypto.randomBytes(n).toString('hex'); }

function gcSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires < now) sessions.delete(sid);
}
setInterval(gcSessions, 60 * 1000).unref();

// --- cookie helpers --------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach((s) => {
    const i = s.indexOf('=');
    if (i > 0) out[s.slice(0, i).trim()] = decodeURIComponent(s.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAge) {
  let c = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  if (CONFIG.secureCookie !== false) c += '; Secure';
  res.setHeader('Set-Cookie', c);
}
function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Node's setHeader rejects any char outside Latin1 (e.g. Chinese names) with
// ERR_INVALID_CHAR — and that throw happens synchronously inside http.request,
// leaving the client request unanswered (-> NPM 504). Make header values safe.
function headerSafe(v) {
  if (v == null) return '';
  const s = String(v);
  if (/^[\x00-\xFF]*$/.test(s)) return s;   // already Latin1-safe
  return 'enc:' + encodeURIComponent(s);    // ASCII-safe, upstream can decode
}

// --- Feishu API ------------------------------------------------------------
function feishuRequest(method, apiPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const u = new URL(CONFIG.feishuBase + apiPath);
    const options = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: Object.assign(
        { 'Content-Type': 'application/json', Accept: 'application/json' },
        headers || {}
      ),
    };
    if (data) options.headers['Content-Length'] = data.length;
    const req = https.request(options, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400) {
          // Follow one redirect (Feishu sometimes 302s internally).
          const loc = res.headers.location;
          if (loc) {
            const nu = new URL(loc, CONFIG.feishuBase);
            return feishuRequest(method, nu.pathname + nu.search, body, headers)
              .then(resolve, reject);
          }
        }
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error(`Feishu ${method} ${apiPath} -> HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function exchangeCode(code) {
  // Standard Feishu OAuth2 browser-redirect flow (authorization_code grant).
  // NOTE: endpoint is /open-apis/authen/v2/oauth/token and the response is FLAT
  // (access_token / open_id / name / email at top level, not under `data`).
  const r = await feishuRequest(
    'POST',
    '/open-apis/authen/v2/oauth/token',
    JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CONFIG.appId,
      client_secret: CONFIG.appSecret,
      code,
      redirect_uri: CONFIG.redirectUri,
    })
  );
  if (r.code !== 0) throw new Error('oauth_token failed: ' + JSON.stringify(r));
  return r; // flat: { access_token, open_id, name, email, ... }
}
async function getUserInfo(accessToken) {
  // Best-effort enrichment via v1/user_info. If it fails we fall back to the
  // fields already present in the token response.
  try {
    const r = await feishuRequest('GET', '/open-apis/authen/v1/user_info', null, {
      Authorization: 'Bearer ' + accessToken,
    });
    if (r.code === 0 && r.data) return r.data;
  } catch (e) {
    // ignore — enrichment is optional
  }
  return null;
}

function feishuAuthorizeUrl(state) {
  const q = new URLSearchParams({
    app_id: CONFIG.appId,
    redirect_uri: CONFIG.redirectUri,
    response_type: 'code',
    state,
  });
  return CONFIG.feishuBase + '/open-apis/authen/v1/authorize?' + q.toString();
}

// --- session ---------------------------------------------------------------
function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

// --- upstream proxy to DSH -------------------------------------------------
function proxyToDsh(req, res, session) {
  const up = new URL(CONFIG.dshUpstream);
  const headers = Object.assign({}, req.headers);
  delete headers['connection'];
  delete headers['transfer-encoding'];
  delete headers['upgrade'];
  headers['host'] = up.host;
  headers['x-feishu-open-id'] = headerSafe(session.open_id);
  headers['x-feishu-name'] = headerSafe(session.name);

  const options = {
    protocol: up.protocol,
    hostname: up.hostname,
    port: up.port,
    method: req.method,
    path: req.url,
    headers,
  };
  const p = http.request(options, (pres) => {
    const outHeaders = Object.assign({}, pres.headers);
    delete outHeaders['connection'];
    delete outHeaders['transfer-encoding'];
    res.writeHead(pres.statusCode, outHeaders);
    pres.on('error', () => { try { res.destroy(); } catch (_) {} });
    pres.pipe(res);
  });
  // Never hang on a slow/unresponsive DSH: fail fast instead of letting NPM 504.
  p.setTimeout(CONFIG.upstreamTimeoutMs || 30000, () => {
    if (!res.headersSent) {
      try { res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' }); } catch (_) {}
      try { res.end('Gateway timeout: DSH did not respond in time.'); } catch (_) {}
    }
    try { p.destroy(); } catch (_) {}
  });
  p.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad gateway: ' + e.message);
  });
  // A dropped client / upstream mid-stream must NOT crash the process.
  req.on('error', () => p.destroy());
  res.on('error', () => p.destroy());
  req.pipe(p);
}

// --- HTTP request handler --------------------------------------------------
function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/login') return sendLoginPage(res);
  if (p === '/feishu/authorize') return handleAuthorize(req, res);
  if (p === '/feishu/callback') return handleCallback(req, res);
  if (p === '/logout') return handleLogout(req, res);

  const session = getSession(req);
  if (!session) {
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
      return res.writeHead(302, { Location: '/login' }), res.end();
    }
    return res.writeHead(302, { Location: '/login' }), res.end();
  }
  return proxyToDsh(req, res, session);
}

function sendLoginPage(res) {
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Harness · 登录</title>
<style>
 body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
   font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
   background:#f5f6f8;color:#1f2329}
 .card{background:#fff;padding:40px 48px;border-radius:14px;box-shadow:0 6px 24px rgba(31,35,41,.08);text-align:center}
 h1{font-size:20px;margin:0 0 6px}
 p{color:#646a73;font-size:14px;margin:0 0 28px}
 a.btn{display:inline-block;background:#3370ff;color:#fff;text-decoration:none;padding:11px 28px;border-radius:8px;font-size:15px;font-weight:500}
 a.btn:hover{background:#245bdb}
</style></head><body><div class="card">
 <h1>DeepSeek Harness</h1>
 <p>请使用飞书账号登录以继续</p>
 <a class="btn" href="/feishu/authorize">使用飞书登录</a>
</div></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleAuthorize(req, res) {
  const state = newId(16);
  setCookie(res, STATE_COOKIE, state, 600);
  res.writeHead(302, { Location: feishuAuthorizeUrl(state) });
  res.end();
}

async function handleCallback(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const cookies = parseCookies(req);
  const expectedState = cookies[STATE_COOKIE];

  if (!code || !state || !expectedState || state !== expectedState) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Invalid OAuth state/code.');
  }
  try {
    const token = await exchangeCode(code);
    const info = await getUserInfo(token.access_token) || {};
    const sid = newId(32);
    sessions.set(sid, {
      open_id: info.open_id || token.open_id || '',
      name: info.name || token.name || '',
      email: info.email || token.email || '',
      expires: Date.now() + SESSION_TTL,
    });
    clearCookie(res, STATE_COOKIE);
    setCookie(res, SESSION_COOKIE, sid, SESSION_TTL / 1000);
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Feishu login failed: ' + e.message);
  }
}

function handleLogout(req, res) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
  clearCookie(res, SESSION_COOKIE);
  res.writeHead(302, { Location: '/login' });
  res.end();
}

// --- WebSocket upgrade proxy ----------------------------------------------
function handleUpgrade(req, clientSocket, head) {
  const session = getSession(req);
  if (!session) {
    clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return clientSocket.destroy();
  }
  const up = new URL(CONFIG.dshUpstream);
  const headers = Object.assign({}, req.headers);
  delete headers['connection'];
  delete headers['upgrade'];
  const options = {
    protocol: up.protocol,
    hostname: up.hostname,
    port: up.port,
    method: 'GET',
    path: req.url,
    headers: Object.assign(headers, { host: up.host }),
  };
  const p = http.request(options);
  p.setTimeout(CONFIG.upstreamTimeoutMs || 30000, () => { try { p.destroy(); } catch (_) {} });
  p.on('upgrade', (pres, serverSocket, phead) => {
    clientSocket.write('HTTP/1.1 101 Switching Protocols\r\n');
    for (const [k, v] of Object.entries(pres.headers)) {
      const lk = k.toLowerCase();
      if (lk === 'connection' || lk === 'upgrade') continue;
      clientSocket.write(`${k}: ${v}\r\n`);
    }
    clientSocket.write('Upgrade: websocket\r\n');
    clientSocket.write('Connection: Upgrade\r\n\r\n');
    if (phead && phead.length) serverSocket.write(phead);
    const kill = () => { try { clientSocket.destroy(); } catch (_) {} try { serverSocket.destroy(); } catch (_) {} };
    serverSocket.on('error', kill);
    clientSocket.on('error', kill);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  p.on('error', () => clientSocket.destroy());
  p.end();
}

// --- server ----------------------------------------------------------------
function createServer() {
  const srv = http.createServer(handler);
  srv.on('upgrade', handleUpgrade);
  srv.on('clientError', (e, socket) => {
    if (socket.writable) socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
  });
  return srv;
}

const binds = CONFIG.bindAddresses && CONFIG.bindAddresses.length ? CONFIG.bindAddresses : ['127.0.0.1'];
const port = CONFIG.port || 3090;
const servers = binds.map((addr) => {
  const s = createServer();
  s.listen(port, addr, () => console.log(`[dsh-feishu-auth] listening on ${addr}:${port}`));
  return s;
});
if (servers.length === 0) {
  console.error('No bind address configured');
  process.exit(1);
}
process.on('SIGTERM', () => servers.forEach((s) => s.close()));
process.on('SIGINT', () => servers.forEach((s) => s.close()));
