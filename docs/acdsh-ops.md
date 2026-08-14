# acdsh 运维文档

## 1. 部署目标

- 服务器：`116.62.188.165`（Alibaba Cloud Linux 3）
- NPM 容器 `nginx-app`（jc21/nginx-proxy-manager:2.9.19），数据卷 `/clouddream/nginx-proxy-manage`
- 代理服务目录：`/opt/dsh-feishu-auth/`

## 2. 部署清单

| 项 | 值 |
|----|----|
| NPM proxy_host id | 7 |
| 反代目标 | 172.18.0.1:3090 |
| TLS 证书 | NPM cert id=15（Let's Encrypt DNS-01 阿里云） |
| 强制 HTTPS | 是（ssl_forced=true） |
| 会话 Cookie | httpOnly + Secure |

## 3. systemd 服务

`/etc/systemd/system/dsh-feishu-auth.service`：`Restart=always`、`RestartSec=3`。

健康检查与自愈：

- `/opt/dsh-feishu-auth/healthcheck.sh`：curl 127.0.0.1:3090/login，超时/非 200 则 `systemctl restart` 并写 journal；
- timer `dsh-feishu-auth-health.timer`：每分钟一次（`enable --now`，active）。

常用命令：

```bash
systemctl status dsh-feishu-auth
journalctl -u dsh-feishu-auth -f
systemctl restart dsh-feishu-auth
```

## 4. 证书续期

LE 证书由 NPM 自动续期（DNS-01 阿里云凭据复用 cert 7 的 meta）。关注 cert id=15 到期日（2026-11-12），到期前确认自动续期正常。

## 5. 故障排查速查表

| 现象 | 根因 | 处理 |
|------|------|------|
| 502 Bad Gateway | 代理流 EPIPE/ECONNRESET 未处理导致进程崩溃 | 代码已加 error 监听 + 进程安全网；`systemctl restart` |
| 504 超时（干等） | DSH 慢/卡 | 出站 30s 超时已加；查 DSH 自身状态 |
| 504（登录后必现） | 中文飞书昵称写入头触发 ERR_INVALID_CHAR | 已加 headerSafe；确认线上为最新 server.js |
| /api/* 403 | 代理转发 Origin(acdsh) ≠ loopback Host | 已删除 Origin/Sec-Fetch-Site；确认 Host=127.0.0.1:3080 |
| 本地 127.0.0.1:3100 拒绝 | 本地 DSH 端口是 3080 | 用 `dsh --profile web`（3080） |

## 6. 变更与回滚

- 改 server.js：scp 到 `/opt/dsh-feishu-auth/`，`systemctl restart dsh-feishu-auth`；
- NPM proxy_host 改 DB 后需触发 API 渲染（PUT 白名单字段）才会生效；
- 回滚：git 回退对应 commit，重新部署。

## 7. GitHub 同步与本地对齐

- 远程：`sunxufeng/acdsh` main；
- 本环境可直连 github.com，对齐命令：

  ```bash
  git fetch origin && git reset --hard origin/main
  ```

- 真实 config.json 始终 gitignore，未提交。

## 8. 凭据与路径清单

- NPM 登录：`sunxufeng@outlook.com` / 密码（用于 `/api/tokens`，Bearer）
- 飞书 app_id：`cli_aaf46edcd8b8dcc2`；app_secret 仅存服务器 config.json（权限 600）
- 飞书开放平台需登记 redirect_uri：`https://acdsh.areteailab.com/feishu/callback`
- NPM 数据/DB：`/clouddream/nginx-proxy-manage/data/database.sqlite`

## 9. 监控建议

- 每分钟健康检查已覆盖进程存活；
- 建议对 `/login` 200、TLS 证书剩余天数做外部拨测/告警。
