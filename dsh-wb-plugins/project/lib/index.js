/**
 * dsh-wb-project — 参考 WorkBuddy 的「项目/计划看板」功能。
 * 管理项目(Project)与任务(Task)两级实体,任务含状态(backlog/active/paused/done)、负责人、备注。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-project'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const PF = path.join(DATA_DIR, 'projects.json')
const TF = path.join(DATA_DIR, 'tasks.json')
const STATUSES = ['backlog', 'active', 'paused', 'done']

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readP() { ensure(); try { return JSON.parse(fs.readFileSync(PF, 'utf8')) } catch { return [] } }
function readT() { ensure(); try { return JSON.parse(fs.readFileSync(TF, 'utf8')) } catch { return [] } }
function writeP(l) { ensure(); fs.writeFileSync(PF, JSON.stringify(l, null, 2)) }
function writeT(l) { ensure(); fs.writeFileSync(TF, JSON.stringify(l, null, 2)) }

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
    name: 'wb-project', order: 122,
    text: '你拥有 WorkBuddy 风格的项目/任务看板能力:project_create/list/get/delete 管理项目,' +
      'task_create/list/get/update/status/delete 管理任务,board_view 按状态查看看板。' +
      '当用户提到「项目/任务/待办/看板/计划」时优先使用这些工具。',
  })

  ctx.tools.register(mk('project_create', '创建一个项目。', {
    name: { type: 'string', description: '项目名称' },
    description: { type: 'string', description: '项目描述' },
  }, ['name'], (args) => {
    const l = readP()
    const p = { id: crypto.randomUUID().slice(0, 8), name: args.name, description: args.description || '', createdAt: new Date().toISOString() }
    l.push(p); writeP(l)
    return `已创建项目 "${p.name}" (${p.id})。`
  }))

  ctx.tools.register(mk('project_list', '列出所有项目(附任务数)。', {}, [], () => {
    const ps = readP(); const ts = readT()
    if (!ps.length) return '（暂无项目）用 project_create 创建。'
    return ps.map(p => { const n = ts.filter(t => t.projectId === p.id).length; return `- ${p.name} [${p.id}]  任务数:${n}` }).join('\n')
  }))

  ctx.tools.register(mk('project_get', '查看项目详情及其全部任务。', {
    id: { type: 'string', description: '项目 id' },
  }, ['id'], (args) => {
    const p = readP().find(x => x.id === args.id)
    if (!p) return '未找到项目: ' + args.id
    const ts = readT().filter(t => t.projectId === p.id)
    const lines = [`项目: ${p.name} [${p.id}]`, p.description || '', '任务:']
    if (!ts.length) lines.push('  (无)')
    else ts.forEach(t => lines.push(`  - [${t.status}] ${t.title} [${t.id}]${t.assignee ? ' @' + t.assignee : ''}`))
    return lines.join('\n')
  }))

  ctx.tools.register(mk('project_delete', '删除项目(同时删除其下任务)。', {
    id: { type: 'string', description: '项目 id' },
  }, ['id'], (args) => {
    const l = readP(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到项目: ' + args.id
    const [rm] = l.splice(i, 1); writeP(l)
    writeT(readT().filter(t => t.projectId !== args.id))
    return `已删除项目 "${rm.name}" 及其任务。`
  }))

  ctx.tools.register(mk('task_create', '在项目下创建任务。', {
    projectId: { type: 'string', description: '所属项目 id' },
    title: { type: 'string', description: '任务标题' },
    status: { type: 'string', enum: STATUSES, description: '状态: backlog/active/paused/done(默认 backlog)' },
    assignee: { type: 'string', description: '负责人' },
    notes: { type: 'string', description: '备注' },
  }, ['projectId', 'title'], (args) => {
    if (!readP().find(p => p.id === args.projectId)) return '项目不存在: ' + args.projectId
    const l = readT()
    const t = { id: crypto.randomUUID().slice(0, 8), projectId: args.projectId, title: args.title, status: STATUSES.includes(args.status) ? args.status : 'backlog', assignee: args.assignee || '', notes: args.notes || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    l.push(t); writeT(l)
    return `已创建任务 "${t.title}" [${t.id}] 状态=${t.status}`
  }))

  ctx.tools.register(mk('task_list', '列出任务,可按项目或状态过滤。', {
    projectId: { type: 'string', description: '按项目过滤;不传=全部项目' },
    status: { type: 'string', enum: STATUSES, description: '按状态过滤;不传=不过滤' },
  }, [], (args) => {
    let ts = readT()
    if (args.projectId) ts = ts.filter(t => t.projectId === args.projectId)
    if (args.status && STATUSES.includes(args.status)) ts = ts.filter(t => t.status === args.status)
    if (!ts.length) return '（无匹配任务）'
    return ts.map(t => `- [${t.status}] ${t.title} [${t.id}]${t.assignee ? ' @' + t.assignee : ''}`).join('\n')
  }))

  ctx.tools.register(mk('task_get', '查看单个任务详情。', {
    id: { type: 'string', description: '任务 id' },
  }, ['id'], (args) => {
    const t = readT().find(x => x.id === args.id)
    if (!t) return '未找到任务: ' + args.id
    return JSON.stringify(t, null, 2)
  }))

  ctx.tools.register(mk('task_update', '更新任务的标题/负责人/备注。', {
    id: { type: 'string', description: '任务 id' },
    title: { type: 'string', description: '新标题' },
    assignee: { type: 'string', description: '新负责人' },
    notes: { type: 'string', description: '新备注' },
  }, ['id'], (args) => {
    const l = readT(); const t = l.find(x => x.id === args.id)
    if (!t) return '未找到任务: ' + args.id
    if (args.title) t.title = args.title
    if (args.assignee) t.assignee = args.assignee
    if (args.notes) t.notes = args.notes
    t.updatedAt = new Date().toISOString(); writeT(l)
    return `已更新任务 [${t.id}]。`
  }))

  ctx.tools.register(mk('task_status', '修改任务状态(backlog/active/paused/done)。', {
    id: { type: 'string', description: '任务 id' },
    status: { type: 'string', enum: STATUSES, description: '新状态' },
  }, ['id', 'status'], (args) => {
    const l = readT(); const t = l.find(x => x.id === args.id)
    if (!t) return '未找到任务: ' + args.id
    t.status = args.status; t.updatedAt = new Date().toISOString(); writeT(l)
    return `任务 [${t.id}] 状态 -> ${args.status}`
  }))

  ctx.tools.register(mk('task_delete', '删除任务。', {
    id: { type: 'string', description: '任务 id' },
  }, ['id'], (args) => {
    const l = readT(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到任务: ' + args.id
    const [rm] = l.splice(i, 1); writeT(l)
    return `已删除任务 "${rm.title}"。`
  }))

  ctx.tools.register(mk('board_view', '按状态(backlog/active/paused/done)分组展示某项目的看板。', {
    projectId: { type: 'string', description: '项目 id;不传=全部项目' },
  }, [], (args) => {
    let ts = readT()
    if (args.projectId) ts = ts.filter(t => t.projectId === args.projectId)
    return STATUSES.map(s => {
      const items = ts.filter(t => t.status === s)
      const body = items.length ? items.map(t => `  - ${t.title} [${t.id}]${t.assignee ? ' @' + t.assignee : ''}`).join('\n') : '  (空)'
      return `【${s}】\n${body}`
    }).join('\n')
  }))
}
