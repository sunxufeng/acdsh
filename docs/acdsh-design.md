# acdsh 架构设计文档

> 项目：DeepSeek Harness（DSH）生产环境 + 飞书 OAuth 登录代理
> 域名：acdsh.areteailab.com
> 维护：峰哥

## 1. 背景与目标

将 DeepSeek Harness（DSH）以安全、可控的方式暴露到公网，供团队通过飞书账号登录后使用。核心目标：

- 用飞书 OAuth 登录代替原始 Basic Auth，提升安全性与可用性；
- 通过 Nginx Proxy Manager（NPM）做 HTTPS 终止与反向代理；
- 前置一层轻量登录代理，把飞书身份注入到 DSH 请求，同时绕过 DSH 自身的 /api 信任栅栏；
- 具备进程级与系统级自愈能力，减少 5xx 故障。

## 2. 整体架构

```
浏览器
  │  HTTPS（强制跳转，Let's Encrypt）
  ▼
NPM（nginx-proxy-manager，容器 nginx-app）
  │  proxy_host id=7 → 172.18.0.1:3090，cert 15，ssl_forced
  ▼
飞书登录代理 dsh-feishu-auth（172.18.0.1:3090 / 127.0.0.1:3090）
  │  纯 Node.js 标准库，无第三方依赖
  │  - /login /feishu/authorize /feishu/callback /logout
  │  - 登录成功后签 httpOnly+Secure 会话 Cookie
  │  - 反向代理（含 WebSocket upgrade）到 DSH
  ▼
DSH（127.0.0.1:3080）
  - dsh-web（Web UI + /api RPC）
  - dsh-bridge（socat 172.18.0.1:3080）
```

## 3. 组件与端口

| 组件 | 地址 | 说明 |
|------|------|------|
| NPM nginx-app | 容器 | 反代 + TLS 终止，proxy_host id=7 |
| dsh-feishu-auth | 172.18.0.1:3090、127.0.0.1:3090 | 飞书登录代理 |
| dsh-web | 127.0.0.1:3080 | DSH Web UI |
| dsh-bridge | socat 172.18.0.1:3080 | DSH 桥接 |

## 4. 认证与信任模型

### 4.1 飞书 OAuth 登录流程

1. 未登录访问 → 302 到 `/login`；
2. `/feishu/authorize` 带 CSRF state cookie，302 到 `open.feishu.cn/open-apis/authen/v1/authorize`；
3. 飞书回调 `/feishu/callback?code=...`，代理用 `POST /open-apis/authen/v2/oauth/token`（client_id/client_secret/code/redirect_uri）换 token，响应为扁平结构（access_token/open_id/name 在顶层）；
4. 签 httpOnly+Secure 会话 Cookie，后续请求携带即视为已登录；
5. 代理把 `x-feishu-open-id` / `x-feishu-name` 注入上游请求头（经 headerSafe 处理）。

> 注意：飞书重定向 OAuth 必须用 `v2/oauth/token`；`v1/access_token` 是 JSSDK 预授权码流程，会 404 `Not Found`。

### 4.2 DSH /api 信任栅栏

DSH 的 `isTrustedApiRequest` 规则：

- Host 必须是 loopback 或受信任主机；
- `Sec-Fetch-Site: cross-site` 拒绝；
- 若带 `Origin`，则要求 `Origin` 的 host == `Host` 的 host。

代理反代时**保留 Host=127.0.0.1:3080（loopback 过第①关），并删除 Origin 与 Sec-Fetch-Site 头**，使 /api/* 被放行（200）。

## 5. 安全设计

- **headerSafe()**：凡把用户输入/第三方字段（飞书昵称、open_id）写入 HTTP 头，先用 `encodeURIComponent` 编码非 Latin1 字符（`enc:` 前缀），避免 Node `setHeader` 抛 `ERR_INVALID_CHAR` 卡死请求；
- **流错误安全网**：代理流（req/res/pres/socket）均加 error 监听，断开即 destroy 对端，不抛错；顶部加 `process.on('uncaughtException'/'unhandledRejection')`，单条异常绝不杀进程；
- **出站超时**：`http.request` 加 `setTimeout(30000)`，DSH 慢/卡时快速返回 504/502，而非干等 NPM 60s；
- **凭据隔离**：真实 `config.json`（含飞书 app_secret）权限 600、gitignore，从不提交；公网仅经会话 Cookie 鉴权。

## 6. 证书方案

LE 证书用 **DNS-01（阿里云）** 签发（与 areteailab.com 其他子域一致）。HTTP-01 在本环境因公网解析/CDN 与端口 80 不可靠而失败。NPM cert id=15，有效期至 2026-11-12。

## 7. 高可用与自愈

- systemd `Restart=always` + `RestartSec=3`；
- 每分钟 healthcheck（curl 127.0.0.1:3090/login），异常自动 restart；
- 进程级 uncaughtException 安全网兜底。

## 8. 关键约束 / 踩坑

- 中文飞书昵称是 504 的真凶（非 ASCII 头值）；
- /api 必须 POST + application/json，GET 返回 404（与 403 不同）；
- NPM proxy_host 配置只在 API 变更时重新渲染，改 DB 后要触发渲染。
