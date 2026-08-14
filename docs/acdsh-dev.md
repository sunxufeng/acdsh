# acdsh 开发文档

## 1. 代码仓库

GitHub：`sunxufeng/acdsh`（main 分支）。包含：

- `server.js`：飞书登录代理主程序（纯 Node.js 标准库，无第三方依赖）
- `config.example.json`：配置样例
- `config.json`：真实配置（gitignore，含 app_secret，权限 600）
- `dsh-feishu-auth.service`：systemd unit
- `README.md`、`.gitignore`

> 真实 config.json 永不提交；app_secret 仅存服务器本地。

## 2. server.js 结构

| 函数 / 路由 | 作用 |
|-------------|------|
| `headerSafe(v)` | 非 Latin1 字符 encodeURIComponent 编码，保证可写入 HTTP 头 |
| `proxyToDsh(req,res)` | 反向代理 HTTP 到 DSH（保留 loopback Host，删除 Origin/Sec-Fetch-Site，注入 x-feishu-*） |
| `handleUpgrade(req,socket,head)` | WebSocket upgrade 代理 |
| `/login` | 登录页 |
| `/feishu/authorize` | 生成 state cookie 并 302 到飞书 authorize |
| `/feishu/callback` | 用 code 换 token，建会话 |
| `/logout` | 清除会话 |

关键加固点（对应线上故障）：

- 流 error 监听 + 进程级 uncaughtException 安全网 → 防 502；
- 出站 `setTimeout(30000)` → 防 504 干等；
- headerSafe 处理中文昵称 → 防 ERR_INVALID_CHAR 导致的 504；
- 删除 Origin/Sec-Fetch-Site → 解 /api 403。

## 3. 配置

`config.json` 字段（详见 `config.example.json`）：

- `feishuAppId` / `feishuAppSecret`：飞书应用凭证
- `feishuBase`：飞书域名（国内 `https://open.feishu.cn`，国际版改 `https://open.larksuite.com`）
- `redirectUri`：`https://acdsh.areteailab.com/feishu/callback`
- `upstream`：DSH 地址 `127.0.0.1:3080`
- `upstreamTimeoutMs`：出站超时，默认 30000
- `sessionSecret`：会话 Cookie 签名密钥

## 4. 本地开发与运行

前置：本机已安装 `dsh`（默认网页端口 127.0.0.1:3080，**不是** 3100）。

```bash
# 启动 DSH 本地实例（无登录验证）
dsh --profile web

# 另开终端启动登录代理
node server.js
# 访问 http://127.0.0.1:3090/login
```

## 5. 部署到服务器

```bash
scp server.js config.json user@116.62.188.165:/opt/dsh-feishu-auth/
# 服务器上
chmod 600 /opt/dsh-feishu-auth/config.json /opt/dsh-feishu-auth/server.js
cp dsh-feishu-auth.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now dsh-feishu-auth
```

## 6. 验证方法

- 公网：`https://acdsh.areteailab.com/login` 应 200；
- 未登录访问 `/` → 302 `/login`；
- 飞书登录后：`/api/settings.describe`、`/api/agentPreset.list`、`/api/host.listDirectory` 均 200；
- 本地健康检查：`curl 127.0.0.1:3090/login`。

## 7. API 约定

DSH `/api/*` 必须是 `POST` + `Content-Type: application/json` + JSON body（含 rpcId/method/payload）；GET 返回 404。

## 8. 常见开发坑

- 飞书重定向 OAuth 用 `v2/oauth/token`（扁平响应）；`v1/access_token` 是 JSSDK 流程，会 404；
- 不要把非 ASCII 直接写 HTTP 头；
- 代理到 DSH 必须保留 loopback Host 并去掉 Origin。
