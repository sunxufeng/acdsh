/**
 * dsh-wb-assistant — 参考 WorkBuddy 的「助理」功能。
 * 管理可切换的「助理角色」:每个助理含名称、角色定位、系统提示词与可选工具范围。
 * 激活后,其系统提示词被注入当前及后续会话(通过 systemPrompt.section 动态读取 active 文件)。
 * 注意:defineTool 的 parameters/output.schema 直接用裸 JSON Schema(与 dsh-tool-todo 一致)。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-assistant'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const FILE = path.join(DATA_DIR, 'assistants.json')
const ACTIVE = path.join(DATA_DIR, 'active-assistant.txt')

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readAll() { ensure(); try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function writeAll(l) { ensure(); fs.writeFileSync(FILE, JSON.stringify(l, null, 2)) }
function getActive() { try { return fs.readFileSync(ACTIVE, 'utf8').trim() } catch { return '' } }
function setActive(id) { ensure(); if (id) fs.writeFileSync(ACTIVE, id); else { try { fs.unlinkSync(ACTIVE) } catch {} } }

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
    name: 'wb-assistant', order: 120,
    text: () => {
      const id = getActive()
      if (!id) return '当前未激活任何 WorkBuddy 助理。可用 assistant_activate <id> 选择,或 assistant_list 查看。'
      const a = readAll().find(x => x.id === id)
      if (!a) return '当前激活的助理已不存在(可能已被删除),建议 assistant_deactivate。'
      return '【当前助理角色】' + a.name + '\n定位:' + a.role + '\n' + (a.systemPrompt || '')
    },
  })

  ctx.tools.register(mk('assistant_list', '列出所有已配置的 WorkBuddy 助理(名称/角色/工具范围),并标记当前激活项。', {}, [], () => {
    const list = readAll(); const active = getActive()
    if (!list.length) return '（暂无助理）用 assistant_add 创建一个。'
    return list.map((a, i) => `${i + 1}. ${a.name} [${a.id}]${a.id === active ? '  <== 已激活' : ''}\n   角色: ${a.role}\n   工具: ${a.tools && a.tools.length ? a.tools.join(', ') : '(不限制)'}`).join('\n')
  }))

  ctx.tools.register(mk('assistant_add', '创建一个新的 WorkBuddy 助理:名称、角色定位、系统提示词与可选工具范围。', {
    name: { type: 'string', description: '助理名称' },
    role: { type: 'string', description: '一句话角色定位:这个助理是谁、负责什么' },
    systemPrompt: { type: 'string', description: '注入给模型的系统提示词(行为准则/知识边界)' },
    tools: { type: 'array', items: { type: 'string' }, description: '该助理可使用的工具名列表;不传=不限制' },
    model: { type: 'string', description: '可选:指定模型名' },
  }, ['name', 'role'], (args) => {
    const list = readAll()
    const a = { id: crypto.randomUUID().slice(0, 8), name: args.name, role: args.role, systemPrompt: args.systemPrompt || '', tools: args.tools || [], model: args.model || '', createdAt: new Date().toISOString() }
    list.push(a); writeAll(list)
    return `已创建助理 "${a.name}" (${a.id})。用 assistant_activate ${a.id} 激活。`
  }))

  ctx.tools.register(mk('assistant_get', '查看某个助理的完整配置。', {
    id: { type: 'string', description: '助理 id' },
  }, ['id'], (args) => {
    const a = readAll().find(x => x.id === args.id)
    if (!a) return '未找到助理: ' + args.id
    return JSON.stringify(a, null, 2)
  }))

  ctx.tools.register(mk('assistant_activate', '激活一个助理:将其系统提示词注入当前及后续会话。', {
    id: { type: 'string', description: '助理 id' },
  }, ['id'], (args) => {
    const a = readAll().find(x => x.id === args.id)
    if (!a) return '未找到助理: ' + args.id
    setActive(a.id)
    return `已激活助理 "${a.name}"。其角色与系统提示词已注入会话(可通过 assistant_deactivate 取消)。`
  }))

  ctx.tools.register(mk('assistant_deactivate', '取消当前激活的助理。', {}, [], () => { setActive(''); return '已取消激活助理。' }))

  ctx.tools.register(mk('assistant_delete', '删除一个助理(不影响其曾注入的会话历史)。', {
    id: { type: 'string', description: '助理 id' },
  }, ['id'], (args) => {
    const list = readAll(); const i = list.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到助理: ' + args.id
    const [removed] = list.splice(i, 1); writeAll(list)
    if (getActive() === removed.id) setActive('')
    return `已删除助理 "${removed.name}"。`
  }))
}
