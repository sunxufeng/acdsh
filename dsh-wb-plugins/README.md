# dsh-wb-plugins

把 WorkBuddy 的核心能力移植到 DSH（DeepSeek Harness）的插件集合。每个插件用 DSH 的 `defineTool` 注册 agent 工具，数据用 `node:fs` 持久化到 `~/.dsh/wb/*.json`，并通过 `systemPrompt.section` 把能力说明注入会话。

## 插件清单

| 插件 | 对应 WorkBuddy 功能 | 提供的工具 |
|---|---|---|
| `dsh-wb-assistant` | 助理 | `assistant_list / add / get / activate / deactivate / delete` |
| `dsh-wb-project` | 项目 / 计划看板 | `project_create / list / get / delete`、`task_create / list / get / update / status / delete`、`board_view` |
| `dsh-wb-expert` | 专家 | `expert_list / add / get / activate / deactivate / delete` |
| `dsh-wb-skill` | 技能 | `skill_list / search / get / add / delete` |
| `dsh-wb-connector` | 连接器 | `connector_list / add / get / delete / test` |
| `dsh-wb-library` | 资料库 | `library_create / list`、`doc_add / list / get / search / delete` |
| `dsh-wb-feishu-doc` | 连接飞书文档（对标 WorkBuddy「连接腾讯文档」） | `feishu_config_set / auth_status`、`feishu_doc_list / read / create / update`、`feishu_wiki_list` |

## 安装方式

```bash
# 本地打包
cd <plugin-dir> && npm pack

# 安装到 DSH web profile
dsh plugin --profile web add file:/path/to/dsh-wb-<feature>-0.1.x.tgz
```

更新时先 `dsh plugin --profile web remove dsh-wb-<feature>` 再 `add`（避免 pnpm 缓存旧 tgz）。

## 飞书文档插件配置

`dsh-wb-feishu-doc` 读 `~/.dsh/wb/feishu-config.json`：

```json
{
  "appId": "cli_xxxx",
  "appSecret": "xxxx",
  "userAccessToken": "t-xxxx"
}
```

- 填 `userAccessToken`（来自飞书 API Explorer 对目标应用授权）可读取个人云空间；
- 或填自建应用 `appId`+`appSecret` 走 `tenant_access_token`（仅能访问应用被授权的资源）；
- 支持 `refreshToken` + 自动续期（需走标准 OAuth 拿到 refresh_token）。

## 备注

- `defineTool` 的 `parameters` 必须用「隐式开放对象」格式（根直接是 `属性 → value schema` 映射，必填用属性内 `required: true`），不能用 schematry 的 `z.object({...})`。
- 各插件内部依赖 DSH 的 `@deepseek-ai/*` 包，在 `package.json` 以 `peerDependencies` 声明。
