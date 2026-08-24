/**
 * dsh-wb-automation — 参考 WorkBuddy 的「自动化」功能。
 * 管理可触发的「工作流」:每个自动化包含名称、描述、触发器(manual/cron/event)、动作步骤(LLM 要按顺序执行的任务描述列表)。
 * 数据存于 ~/.dsh/wb/automations.json 与 ~/.dsh/wb/automation-runs.json。
 * 注:本插件定义的是自动化规格——由调度器(用户/外部)读取后驱动 DSH 会话按步骤执行;不内置定时执行。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-automation'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const FILE = path.join(DATA_DIR, 'automations.json')
const RUNS = path.join(DATA_DIR, 'automation-runs.json')
const TRIGGERS = ['manual', 'cron', 'event']

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readAll() { ensure(); try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function writeAll(l) { ensure(); fs.writeFileSync(FILE, JSON.stringify(l, null, 2)) }
function readRuns() { ensure(); try { return JSON.parse(fs.readFileSync(RUNS, 'utf8')) } catch { return [] } }
function appendRun(r) {
  ensure()
  const all = readRuns()
  all.unshift(r)                          // 最新的在前面
  fs.writeFileSync(RUNS, JSON.stringify(all.slice(0, 500), null, 2))   // 仅保留 500 条
}

export const inject = ['tools', 'systemPrompt']

function mk(name, description, properties, required, run) {
  return defineTool({
    name, description,
    parameters: Object.fromEntries(Object.entries(properties || {}).map(([k, v]) => [k, { ...v, ...(required && required.includes(k) ? { required: true } : {}) }])),
    output: { schema: { type: 'string' }, render: (_, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) { return run(args) },
  })
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'wb-automation', order: 125,
    text: '你拥有 WorkBuddy 风格的自动化管理:automation_add/list/get/toggle/delete/run/run_history。' +
      '一个自动化 = 一组顺序执行的步骤(每步是给 LLM 的自然语言指令,需由被调度到的会话按步骤解释并执行)。' +
      '当你被某个 automation_run 触发时,按 run_id 读取 automation_get(可见步骤),顺序执行并把每步结果回写到 run_history。',
  })

  ctx.tools.register(mk('automation_add', '创建一个自动化工作流:名称、描述、触发器类型、手动/定时/事件触发的步骤说明。', {
    name: { type: 'string', description: '自动化名称' },
    description: { type: 'string', description: '说明这个自动化做什么' },
    trigger: { type: 'string', enum: TRIGGERS, description: '触发类型: manual(手动)/cron(定时)/event(事件)' },
    cron: { type: 'string', description: 'trigger=cron 时的 cron 表达式(如 0 9 * * *)' },
    event: { type: 'string', description: 'trigger=event 时的事件名' },
    steps: { type: 'string', description: 'JSON 数组,每项为一个步骤对象 {title,action};也可以是字符串数组(纯文本指令)' },
    enabled: { type: 'boolean', description: '是否启用,默认 true' },
  }, ['name', 'trigger'], (args) => {
    let parsed = []
    if (args.steps) {
      try {
        const s = JSON.parse(args.steps)
        if (Array.isArray(s)) parsed = s
        else return 'steps 必须是 JSON 数组。'
      } catch (e) { return 'steps 不是合法 JSON: ' + (e instanceof Error ? e.message : String(e)) }
    }
    const l = readAll()
    const a = {
      id: crypto.randomUUID().slice(0, 8),
      name: args.name,
      description: args.description || '',
      trigger: args.trigger,
      cron: args.cron || '',
      event: args.event || '',
      steps: parsed,
      enabled: args.enabled !== false,
      createdAt: new Date().toISOString(),
    }
    l.push(a); writeAll(l)
    return `已创建自动化 "${a.name}" (${a.id}, ${a.trigger})。共 ${a.steps.length} 个步骤。用 automation_run ${a.id} 立即执行。`
  }))

  ctx.tools.register(mk('automation_list', '列出所有自动化(名称/触发器/启用状态/步骤数)。', {}, [], () => {
    const l = readAll()
    if (!l.length) return '（暂无自动化）用 automation_add 创建。'
    return l.map((a, i) => `${i + 1}. ${a.name} [${a.id}] (${a.trigger}) ${a.enabled ? '✓' : '✗'}\n   ${a.description}\n   步骤: ${a.steps.length}${a.cron ? '   cron: ' + a.cron : ''}${a.event ? '   event: ' + a.event : ''}`).join('\n')
  }))

  ctx.tools.register(mk('automation_get', '读取某个自动化的完整定义(含每一步的 title/action)。', {
    id: { type: 'string', description: '自动化 id' },
  }, ['id'], (args) => {
    const a = readAll().find(x => x.id === args.id)
    if (!a) return '未找到自动化: ' + args.id
    return JSON.stringify(a, null, 2)
  }))

  ctx.tools.register(mk('automation_toggle', '启用/禁用一个自动化。', {
    id: { type: 'string', description: '自动化 id' },
    enabled: { type: 'boolean', description: 'true=启用, false=禁用' },
  }, ['id', 'enabled'], (args) => {
    const l = readAll(); const a = l.find(x => x.id === args.id)
    if (!a) return '未找到自动化: ' + args.id
    a.enabled = !!args.enabled; writeAll(l)
    return `已${a.enabled ? '启用' : '禁用'}自动化 "${a.name}"。`
  }))

  ctx.tools.register(mk('automation_delete', '删除一个自动化(不删除其历史运行记录)。', {
    id: { type: 'string', description: '自动化 id' },
  }, ['id'], (args) => {
    const l = readAll(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到自动化: ' + args.id
    const [rm] = l.splice(i, 1); writeAll(l)
    return `已删除自动化 "${rm.name}"。`
  }))

  ctx.tools.register(mk('automation_run', '立即执行一个手动自动化:创建一条 run 记录并返回步骤清单(由当前会话按步骤执行)。', {
    id: { type: 'string', description: '自动化 id' },
  }, ['id'], (args) => {
    const a = readAll().find(x => x.id === args.id)
    if (!a) return '未找到自动化: ' + args.id
    const runId = crypto.randomUUID().slice(0, 12)
    const rec = { runId, automationId: a.id, name: a.name, startedAt: new Date().toISOString(), status: 'running', steps: a.steps.map((s, i) => ({ index: i, title: typeof s === 'string' ? s : (s.title || ('步骤 ' + (i + 1))), action: typeof s === 'string' ? s : (s.action || ''), status: 'pending' })) }
    appendRun(rec)
    return `已创建运行 runId=${runId} (${a.name}),共 ${rec.steps.length} 步。请按步骤顺序执行,完成后调用 automation_run_complete 写回结果。\n` + JSON.stringify(rec, null, 2)
  }))

  ctx.tools.register(mk('automation_run_complete', '回写一次运行的执行结果(状态/每步结果/最终输出)。', {
    runId: { type: 'string', description: '运行 id' },
    status: { type: 'string', enum: ['success', 'failed', 'cancelled'], description: '整体结果' },
    finalOutput: { type: 'string', description: '最终输出/总结' },
    stepResults: { type: 'string', description: '可选:JSON 数组,每项 {index,status,output}' },
  }, ['runId', 'status'], (args) => {
    const all = readRuns(); const r = all.find(x => x.runId === args.runId)
    if (!r) return '未找到 runId: ' + args.runId
    r.status = args.status
    r.finalOutput = args.finalOutput || ''
    r.endedAt = new Date().toISOString()
    if (args.stepResults) {
      try {
        const sr = JSON.parse(args.stepResults)
        if (Array.isArray(sr)) r.steps = r.steps.map((st, i) => ({ ...st, ...(sr[i] || {}) }))
      } catch (e) { return 'stepResults 不是合法 JSON: ' + (e instanceof Error ? e.message : String(e)) }
    }
    fs.writeFileSync(RUNS, JSON.stringify(all, null, 2))
    return `已记录 runId=${args.runId} 的执行结果: ${args.status}`
  }))

  ctx.tools.register(mk('automation_run_history', '查看某个自动化的运行历史(默认最近 20 条,可指定 limit)。', {
    id: { type: 'string', description: '自动化 id;不传则查全部' },
    limit: { type: 'number', description: '返回条数,默认 20' },
  }, [], (args) => {
    const limit = Math.max(1, Math.min(200, Number(args.limit) || 20))
    let all = readRuns()
    if (args.id) all = all.filter(r => r.automationId === args.id)
    if (!all.length) return '（暂无运行记录）'
    return all.slice(0, limit).map(r => {
      const ended = r.endedAt ? new Date(r.endedAt).toISOString() : '(运行中)'
      return `${r.runId}  ${r.name || r.automationId}  ${r.startedAt} → ${ended}  [${r.status || 'running'}]`
    }).join('\n')
  }))
}
