/**
 * dsh-wb-connector — 参考 WorkBuddy 的「连接器」功能。
 * 管理外部服务连接配置:类型(HTTP/MCP/自定义)、端点、认证方式(apiKey/bearer/oauth/none)与附加 headers。
 * 凭据以明文存于本地 ~/.dsh/wb/connectors.json,仅适合本地受信环境;敏感密钥请勿写入共享部署。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-connector'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const FILE = path.join(DATA_DIR, 'connectors.json')
const TYPES = ['http', 'mcp', 'custom']
const AUTH = ['none', 'apiKey', 'bearer', 'oauth']

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readAll() { ensure(); try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] } }
function writeAll(l) { ensure(); fs.writeFileSync(FILE, JSON.stringify(l, null, 2)) }
function mask(k) { if (!k) return '(空)'; return k.slice(0, 4) + '****' + k.slice(-2) }

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
    name: 'wb-connector', order: 124,
    text: '你拥有 WorkBuddy 风格的连接器管理:connector_list/add/get/delete/test 维护外部服务连接(端点与认证)。' +
      '需要调用第三方 API 时,先用 connector_list 找到可用连接,再用 connector_get 读取完整配置(含密钥)。',
  })

  ctx.tools.register(mk('connector_list', '列出所有连接器(名称/类型/端点,密钥脱敏显示)。', {}, [], () => {
    const l = readAll()
    if (!l.length) return '（暂无连接器）用 connector_add 添加一个。'
    return l.map((c, i) => `${i + 1}. ${c.name} [${c.id}] (${c.type})\n   ${c.baseURL}\n   auth: ${c.authType}  key: ${mask(c.apiKey)}`).join('\n')
  }))

  ctx.tools.register(mk('connector_add', '添加一个外部服务连接器。', {
    name: { type: 'string', description: '连接器名称' },
    type: { type: 'string', enum: TYPES, description: '类型: http/mcp/custom' },
    baseURL: { type: 'string', description: '服务端点根地址' },
    authType: { type: 'string', enum: AUTH, description: '认证方式: none/apiKey/bearer/oauth' },
    apiKey: { type: 'string', description: '密钥或 token(明文存于本地,谨慎使用)' },
    headers: { type: 'string', description: '额外请求头,JSON 对象字符串,如 {"X-Tenant":"abc"}' },
    notes: { type: 'string', description: '备注' },
  }, ['name', 'type'], (args) => {
    let h = {}
    if (args.headers) { try { h = JSON.parse(args.headers) } catch { return 'headers 不是合法 JSON: ' + args.headers } }
    const l = readAll()
    const c = { id: crypto.randomUUID().slice(0, 8), name: args.name, type: args.type, baseURL: args.baseURL || '', authType: AUTH.includes(args.authType) ? args.authType : 'none', apiKey: args.apiKey || '', headers: h, notes: args.notes || '', createdAt: new Date().toISOString() }
    l.push(c); writeAll(l)
    return `已添加连接器 "${c.name}" (${c.id})。`
  }))

  ctx.tools.register(mk('connector_get', '读取连接器完整配置(含密钥,明文返回,注意不要在共享环境泄露)。', {
    id: { type: 'string', description: '连接器 id' },
  }, ['id'], (args) => {
    const c = readAll().find(x => x.id === args.id)
    if (!c) return '未找到连接器: ' + args.id
    return JSON.stringify(c, null, 2)
  }))

  ctx.tools.register(mk('connector_delete', '删除一个连接器。', {
    id: { type: 'string', description: '连接器 id' },
  }, ['id'], (args) => {
    const l = readAll(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到连接器: ' + args.id
    const [rm] = l.splice(i, 1); writeAll(l)
    return `已删除连接器 "${rm.name}"。`
  }))

  ctx.tools.register(mk('connector_test', '对连接器做一次探活:GET baseURL,返回状态码与前若干字节。', {
    id: { type: 'string', description: '连接器 id' },
  }, ['id'], async (args) => {
    const c = readAll().find(x => x.id === args.id)
    if (!c) return '未找到连接器: ' + args.id
    if (!c.baseURL) return '该连接器未配置 baseURL,无法探活。'
    try {
      const hd = { ...(c.headers || {}) }
      if (c.authType === 'apiKey') hd['X-API-Key'] = c.apiKey
      else if (c.authType === 'bearer') hd['Authorization'] = 'Bearer ' + c.apiKey
      const r = await fetch(c.baseURL, { method: 'GET', headers: hd, signal: AbortSignal.timeout(10000) })
      const txt = await r.text()
      return `状态码: ${r.status}\n前 300 字节:\n${txt.slice(0, 300)}`
    } catch (e) {
      return '探活失败: ' + (e instanceof Error ? e.message : String(e))
    }
  }))
}
