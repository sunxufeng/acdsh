/**
 * dsh-wb-expert — 参考 WorkBuddy 的「专家」功能。
 * 管理领域专家角色库:每位专家含名称、领域、专长列表、系统提示词与适用场景。激活后注入会话。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-expert'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const FILE = path.join(DATA_DIR, 'experts.json')
const ACTIVE = path.join(DATA_DIR, 'active-expert.txt')

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
    name: 'wb-expert', order: 121,
    text: () => {
      const id = getActive()
      if (!id) return '当前未激活任何 WorkBuddy 专家。可用 expert_activate <id> 注入某领域专家,或 expert_list 浏览。'
      const e = readAll().find(x => x.id === id)
      if (!e) return '当前激活的专家已不存在,建议 expert_deactivate。'
      return '【当前专家】' + e.name + ' / 领域:' + e.domain + '\n专长:' + (e.expertise || []).join('、') + '\n' + (e.systemPrompt || '')
    },
  })

  ctx.tools.register(mk('expert_list', '列出所有专家(名称/领域/专长),并标记当前激活项。', {}, [], () => {
    const list = readAll(); const a = getActive()
    if (!list.length) return '（暂无专家）用 expert_add 添加一个。'
    return list.map((e, i) => `${i + 1}. ${e.name} [${e.id}]${e.id === a ? '  <== 已激活' : ''}\n   领域: ${e.domain}\n   专长: ${(e.expertise || []).join('、')}`).join('\n')
  }))

  ctx.tools.register(mk('expert_add', '添加一个领域专家。', {
    name: { type: 'string', description: '专家名称' },
    domain: { type: 'string', description: '所属领域,如 金融/法律/前端' },
    expertise: { type: 'array', items: { type: 'string' }, description: '专长关键词列表' },
    systemPrompt: { type: 'string', description: '注入给模型的专家系统提示词' },
    whenToUse: { type: 'string', description: '何时应该启用该专家(适用场景)' },
  }, ['name', 'domain'], (args) => {
    const list = readAll()
    const e = { id: crypto.randomUUID().slice(0, 8), name: args.name, domain: args.domain, expertise: args.expertise || [], systemPrompt: args.systemPrompt || '', whenToUse: args.whenToUse || '', createdAt: new Date().toISOString() }
    list.push(e); writeAll(list)
    return `已添加专家 "${e.name}" (${e.id})。用 expert_activate ${e.id} 激活。`
  }))

  ctx.tools.register(mk('expert_get', '查看专家详情。', {
    id: { type: 'string', description: '专家 id' },
  }, ['id'], (args) => {
    const e = readAll().find(x => x.id === args.id)
    if (!e) return '未找到专家: ' + args.id
    return JSON.stringify(e, null, 2)
  }))

  ctx.tools.register(mk('expert_activate', '激活一个专家,将其系统提示词注入会话。', {
    id: { type: 'string', description: '专家 id' },
  }, ['id'], (args) => {
    const e = readAll().find(x => x.id === args.id)
    if (!e) return '未找到专家: ' + args.id
    setActive(e.id)
    return `已激活专家 "${e.name}"(领域:${e.domain})。其系统提示词已注入会话。`
  }))

  ctx.tools.register(mk('expert_deactivate', '取消当前激活的专家。', {}, [], () => { setActive(''); return '已取消激活专家。' }))

  ctx.tools.register(mk('expert_delete', '删除一个专家。', {
    id: { type: 'string', description: '专家 id' },
  }, ['id'], (args) => {
    const list = readAll(); const i = list.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到专家: ' + args.id
    const [removed] = list.splice(i, 1); writeAll(list)
    if (getActive() === removed.id) setActive('')
    return `已删除专家 "${removed.name}"。`
  }))
}
