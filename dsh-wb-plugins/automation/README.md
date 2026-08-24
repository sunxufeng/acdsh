# dsh-wb-automation

参考 WorkBuddy「自动化」功能:为 DSH 提供可触发的「工作流」管理。

## 工具

| 工具 | 用途 |
|---|---|
| `automation_add` | 创建一个自动化(名称/触发器 manual\|cron\|event/步骤序列) |
| `automation_list` | 列出所有自动化 |
| `automation_get` | 读取完整定义(含每步 action) |
| `automation_toggle` | 启用/禁用 |
| `automation_delete` | 删除定义(保留历史) |
| `automation_run` | 立即执行,创建 run 记录并返回步骤清单 |
| `automation_run_complete` | 回写一次运行的执行结果 |
| `automation_run_history` | 查看运行历史 |

## 数据

- `~/.dsh/wb/automations.json` — 自动化定义
- `~/.dsh/wb/automation-runs.json` — 最近 500 条运行记录

## 步骤示例

```json
[
  {"title": "检查待办", "action": "调用 project_list 与 task_list 找出 backlog 中优先级最高的任务"},
  {"title": "写日报", "action": "把今天的 step1 结果写成一个 Markdown 文件,保存为 doc_add 到资料库『日常工作』"}
]
```

`steps` 字段也可以是字符串数组(纯文本指令)。`automation_run` 会为该次执行分配 `runId`,当前会话应按步骤顺序执行,完成后用 `automation_run_complete` 回写状态。
