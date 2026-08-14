# dsh-feishu-auth

Feishu (Lark) OAuth2 login gate in front of [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-R1) (DSH) web UI.

Pure Node.js standard library — **no external dependencies** (avoids native builds / OOM).

## Why

DSH's web UI has no built-in auth. This proxy sits between nginx (HTTPS) and DSH and
requires a successful Feishu login before proxying any request (including WebSocket).

```
Browser → nginx (HTTPS, forced redirect, TLS) → dsh-feishu-auth (:3090) → DSH (127.0.0.1:3080)
```

## Features

- Feishu browser OAuth2 redirect flow (`/open-apis/authen/v2/oauth/token`)
- CSRF `state` cookie protection on the OAuth round-trip
- httpOnly + Secure session cookie (32-byte random id, in-memory store)
- Reverse proxy to DSH including WebSocket `Upgrade`
- Stream error handling so a dropped client/upstream can never crash the process

## Setup

```bash
cd dsh-feishu-auth
cp config.example.json config.json   # then fill in your real appId / appSecret
npm start                            # or: node server.js
```

`config.json` fields:

| field | meaning |
| --- | --- |
| `appId` | Feishu app id (e.g. `cli_...`) |
| `appSecret` | Feishu app secret — **do not commit** |
| `feishuBase` | `https://open.feishu.cn` (Lark intl: `https://open.larksuite.com`) |
| `redirectUri` | Must exactly match the redirect URL registered in the Feishu console, e.g. `https://your-domain/feishu/callback` |
| `dshUpstream` | DSH web URL, e.g. `http://127.0.0.1:3080` |
| `port` | listen port (default 3090) |
| `bindAddresses` | addresses to bind (e.g. `["127.0.0.1","172.18.0.1"]`) |
| `sessionTtlSeconds` | session lifetime (default 86400) |
| `secureCookie` | set session cookie `Secure` (keep true behind HTTPS) |

## Routes

| path | description |
| --- | --- |
| `GET /login` | login page with "Login with Feishu" button |
| `GET /feishu/authorize` | sets CSRF state, 302 to Feishu authorize URL |
| `GET /feishu/callback` | exchanges code for token + user info, sets session, 302 to `/` |
| `GET /logout` | clears session, 302 to `/login` |
| `*` | requires valid session, else 302 to `/login`; if ok, proxy to DSH |

## systemd (example)

`dsh-feishu-auth.service` is provided. Install:

```bash
cp dsh-feishu-auth.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dsh-feishu-auth
```

## nginx / NPM

Point your reverse proxy (e.g. nginx-proxy-manager) at `http://172.18.0.1:3090`
(or `127.0.0.1:3090`) with TLS and forced HTTPS. No Basic Auth needed — the proxy handles login.
