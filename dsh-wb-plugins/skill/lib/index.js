/**
 * dsh-wb-skill — 参考 WorkBuddy 的「技能」功能。
 * 管理可复用的技能包:每个技能含名称、描述、触发词、执行步骤(供 agent 读取后自行执行)。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-skill'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const FILE = path.join(DATA_DIR, 'skills.json')

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readAll() { ensure(); try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function writeAll(l) { ensure(); fs.writeFileSync(FILE, JSON.stringify(l, null, 2)) }

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
    name: 'wb-skill', order: 123,
    text: '你拥有 WorkBuddy 风格的技能库:skill_list/skill_search 可检索技能,skill_get 读取某技能的执行步骤,' +
      'skill_add 收藏新技能。当用户的意图匹配某技能的触发词时,优先用 skill_get 读取步骤再执行。',
  })

  ctx.tools.register(mk('skill_list', '列出所有技能(名称/描述/触发词)。', {}, [], () => {
    const l = readAll()
    if (!l.length) return '（暂无技能）用 skill_add 添加一个。'
    return l.map((s, i) => `${i + 1}. ${s.name} [${s.id}]\n   描述: ${s.description}\n   触发: ${(s.triggers || []).join('、')}`).join('\n')
  }))

  ctx.tools.register(mk('skill_search', '按关键词检索技能(匹配名称/描述/触发词)。', {
    query: { type: 'string', description: '检索关键词' },
  }, ['query'], (args) => {
    const q = args.query.toLowerCase()
    const hits = readAll().filter(s => (s.name + ' ' + s.description + ' ' + (s.triggers || []).join(' ')).toLowerCase().includes(q))
    if (!hits.length) return '未匹配到技能: ' + args.query
    return hits.map(s => `- ${s.name} [${s.id}]: ${s.description}`).join('\n')
  }))

  ctx.tools.register(mk('skill_get', '读取某个技能的完整定义(含执行步骤),供你按步骤执行。', {
    id: { type: 'string', description: '技能 id' },
  }, ['id'], (args) => {
    const s = readAll().find(x => x.id === args.id)
    if (!s) return '未找到技能: ' + args.id
    const steps = (s.steps || []).map((st, i) => `  ${i + 1}. ${st}`).join('\n')
    return `技能: ${s.name}\n描述: ${s.description}\n触发词: ${(s.triggers || []).join('、')}\n步骤:\n${steps}\n` + (s.references ? `参考资料: ${s.references}\n` : '')
  }))

  ctx.tools.register(mk('skill_add', '收藏一个新技能。', {
    name: { type: 'string', description: '技能名称' },
    description: { type: 'string', description: '技能用途描述' },
    triggers: { type: 'array', items: { type: 'string' }, description: '触发词列表' },
    steps: { type: 'array', items: { type: 'string' }, description: '执行步骤(逐条)' },
    references: { type: 'string', description: '参考资料或链接' },
  }, ['name', 'description'], (args) => {
    const l = readAll()
    const s = { id: crypto.randomUUID().slice(0, 8), name: args.name, description: args.description, triggers: args.triggers || [], steps: args.steps || [], references: args.references || '', createdAt: new Date().toISOString() }
    l.push(s); writeAll(l)
    return `已收藏技能 "${s.name}" (${s.id})。`
  }))

  ctx.tools.register(mk('skill_delete', '删除一个技能。', {
    id: { type: 'string', description: '技能 id' },
  }, ['id'], (args) => {
    const l = readAll(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到技能: ' + args.id
    const [rm] = l.splice(i, 1); writeAll(l)
    return `已删除技能 "${rm.name}"。`
  }))
}
