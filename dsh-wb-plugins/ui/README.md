# dsh-wb-ui — WorkBuddy 工作台 UI 入口

为 8 个 `dsh-wb-*` 工具插件提供一个统一的可见 UI 入口。

## 它做什么

在对话输入框左侧注册一个 **🧰 WorkBuddy** 按钮。点击后弹出一个面板，列出：

| 功能 | 对应工具插件 |
|------|------|
| 🤖 助理 | `dsh-wb-assistant` (`assistant_*`) |
| 📁 项目 | `dsh-wb-project` (`project_*`, `task_*`) |
| 🎓 专家 | `dsh-wb-expert` (`expert_*`) |
| 🧩 技能 | `dsh-wb-skill` (`skill_*`) |
| 🔌 连接器 | `dsh-wb-connector` (`connector_*`) |
| ⏰ 自动化 | `dsh-wb-automation` (`automation_*`) |
| 📚 资料库 | `dsh-wb-library` (`library_*`, `doc_*`) |
| 📝 飞书文档 | `dsh-wb-feishu-doc` (`feishu_*`) |

每个功能带若干快捷操作按钮。点击后，会调用输入框 shell 的
`actions.setDraft(prompt)` + `actions.submit()`，把指令填入当前会话并执行——
实际工作由对应的 `dsh-wb-*` 工具插件完成。

## 实现说明

- 纯浏览器端 UI，宿主端 `lib/index.js` 为空挂载点。
- 通过 `ctx.slots.inject("conversation.input.left", ...)` 注册，复用框架的
  composer 输入 shell（`props.keyboard.actions`）直接驱动当前会话。
- 使用 `React.createElement`，无需构建步骤；`react` 由宿主以 peerDependency 提供。
- 与 `dsh-client-ui-*` 系列插件相同的 `window.__ModuleLoader__.load` 模块格式。

## 安装

```bash
pnpm add file:./tgz/dsh-wb-ui-0.1.0.tgz
```

并在 profile 的 `dsh.profile.bundles` 中加入 `dsh-wb-ui`。
