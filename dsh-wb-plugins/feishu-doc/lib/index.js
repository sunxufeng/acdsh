/**
 * dsh-wb-feishu-doc — 参考 WorkBuddy「连接腾讯文档」功能,为 DSH 实现连接飞书文档。
 * 能力:配置凭据、列出云空间文件、读取/创建/编辑 docx、浏览知识库(wiki)。
 * 认证优先级:
 *   1) user_access_token(可访问个人云空间;若带 refresh_token 则自动续期)
 *   2) app_id/app_secret 换取 tenant_access_token(仅能访问应用被授权资源)
 * 凭据明文存于 ~/.dsh/wb/feishu-config.json,仅适合本地受信环境。
 */
import fs from 'node:fs'
import path from 'path'
import os from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-feishu-doc'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const CFG = path.join(DATA_DIR, 'feishu-config.json')
const API = 'https://open.feishu.cn'

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readCfg() { ensure(); try { return JSON.parse(fs.readFileSync(CFG, 'utf8')) } catch { return {} } }
function writeCfg(c) { ensure(); fs.writeFileSync(CFG, JSON.stringify(c, null, 2)) }

// user_access_token 续期缓冲(秒)
const BUFFER = 5 * 60

let tokenCache = { token: '', exp: 0 }

async function postJson(p, body) {
  const r = await fetch(API + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

async function getToken() {
  const c = readCfg()
  // 1) user_access_token 路径
  if (c.userAccessToken) {
    // 已知过期时间且仍在有效期内(留缓冲)→ 直接复用
    if (c.expireAt && Date.now() < c.expireAt - BUFFER * 1000) return c.userAccessToken
    // 接近/已过期的,若有 refresh_token 则尝试刷新
    if (c.refreshToken && c.appId && c.appSecret) {
      try {
        const j = await postJson('/open-apis/authen/v2/oauth/token', {
          grant_type: 'refresh_token', refresh_token: c.refreshToken,
          app_id: c.appId, app_secret: c.appSecret,
        })
        if (j.code === 0 && j.access_token) {
          const nc = readCfg()
          nc.userAccessToken = j.access_token
          if (j.refresh_token) nc.refreshToken = j.refresh_token
          if (j.expires_in) nc.expireAt = Date.now() + (j.expires_in - BUFFER) * 1000
          writeCfg(nc)
          return nc.userAccessToken
        }
      } catch { /* 刷新失败则退回原 token,让后续 API 报错 */ }
    }
    return c.userAccessToken
  }
  // 2) tenant_access_token 路径
  if (!c.appId || !c.appSecret) throw new Error('未配置飞书凭据:用 feishu_config_set 填写 appId/appSecret,或 user_access_token')
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token
  const j = await postJson('/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: c.appId, app_secret: c.appSecret,
  })
  if (j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + j.msg)
  tokenCache = { token: j.tenant_access_token, exp: Date.now() + (j.expire - BUFFER) * 1000 }
  return tokenCache.token
}

async function fq(method, p, body) {
  const token = await getToken()
  const opt = { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }
  if (body !== undefined) opt.body = JSON.stringify(body)
  const r = await fetch(API + p, opt)
  const j = await r.json()
  if (j.code !== 0) throw new Error('飞书 API ' + j.code + ': ' + j.msg)
  return j.data
}

function blockText(b) {
  const f = b.text || b.heading1 || b.heading2 || b.heading3 || b.heading4 || b.heading5 ||
    b.heading6 || b.code || b.quote || b.bullet || b.ordered || b.todo || b.callout
  if (!f) return ''
  const els = f.elements || []
  return els.map(e => (e.text_run ? e.text_run.content : (e.code_run ? e.code_run.content : ''))).join('')
}
const PREFIX = { 3: '## ', 4: '### ', 5: '#### ', 6: '##### ', 7: '###### ', 8: '> ', 9: '- ', 10: '1. ', 11: '- [ ] ', 12: '- [x] ', 13: '```\n', 14: '---' }
function renderBlocks(items) {
  return items.map(b => {
    const pre = PREFIX[b.block_type] || ''
    const t = blockText(b)
    const suf = b.block_type === 13 ? '\n```' : ''
    return pre + t + suf
  }).join('\n')
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
    name: 'wb-feishu-doc', order: 126,
    text: '你拥有连接飞书文档的能力(参考 WorkBuddy 连接腾讯文档):feishu_config_set 配置凭据,' +
      'feishu_doc_list/read/create/update 操作云文档,feishu_wiki_list 浏览知识库。' +
      'user_access_token 可访问个人云空间并支持 refresh_token 自动续期;tenant_access_token 仅能访问应用被授权资源。',
  })

  ctx.tools.register(mk('feishu_config_set', '配置飞书凭据。可填:① user_access_token(及可选 refreshToken/expiresIn 以支持自动续期);② 自建应用 appId/appSecret;③ 授权码 code + redirectUri 由插件自行换取 token。明文存于本地 ~/.dsh/wb/feishu-config.json。', {
    appId: { type: 'string', description: '飞书自建应用 App ID' },
    appSecret: { type: 'string', description: '飞书自建应用 App Secret' },
    userAccessToken: { type: 'string', description: '用户访问令牌(可访问个人云空间)' },
    refreshToken: { type: 'string', description: '刷新令牌(配合 userAccessToken 实现自动续期)' },
    expiresIn: { type: 'number', description: 'userAccessToken 有效期(秒),用于计算过期时间' },
    code: { type: 'string', description: 'OAuth 授权码;提供后插件会用 appId/appSecret/redirectUri 换取 token' },
    redirectUri: { type: 'string', description: '授权码对应的重定向地址(需与应用中配置一致)' },
  }, [], async (args) => {
    const c = readCfg()
    if (args.appId) c.appId = args.appId
    if (args.appSecret) c.appSecret = args.appSecret
    if (args.userAccessToken) { c.userAccessToken = args.userAccessToken; delete c.expireAt }
    if (args.refreshToken) c.refreshToken = args.refreshToken
    if (args.expiresIn) c.expireAt = Date.now() + (args.expiresIn - BUFFER) * 1000
    if (args.code) {
      if (!c.appId || !c.appSecret) throw new Error('用授权码换 token 需要先配置 appId/appSecret')
      const j = await postJson('/open-apis/authen/v2/oauth/token', {
        grant_type: 'authorization_code', code: args.code,
        app_id: c.appId, app_secret: c.appSecret, redirect_uri: args.redirectUri,
      })
      if (j.code !== 0) throw new Error('授权码换取失败: ' + j.msg)
      c.userAccessToken = j.access_token
      if (j.refresh_token) c.refreshToken = j.refresh_token
      if (j.expires_in) c.expireAt = Date.now() + (j.expires_in - BUFFER) * 1000
    }
    writeCfg(c)
    return '已保存飞书配置。userAccessToken=' + (c.userAccessToken ? '(已设置)' : '(空)') +
      ', refreshToken=' + (c.refreshToken ? '(已设置)' : '(空)') +
      ', expireAt=' + (c.expireAt ? new Date(c.expireAt).toISOString() : '(未知)')
  }))

  ctx.tools.register(mk('feishu_auth_status', '显示当前飞书凭据配置状态(类型/是否含 refresh_token/过期时间)。', {}, [], () => {
    const c = readCfg()
    if (c.userAccessToken) {
      let s = '已配置 user_access_token'
      if (c.refreshToken) s += '(含 refresh_token,支持自动续期)'
      if (c.expireAt) {
        const expired = Date.now() > c.expireAt
        s += '; 过期: ' + new Date(c.expireAt).toISOString() + (expired ? ' [已过期,将尝试刷新]' : ' [有效]')
      } else {
        s += '(无过期时间,过期后若无 refresh_token 需重新获取)'
      }
      return s
    }
    if (c.appId && c.appSecret) return '已配置 appId/appSecret:将以 tenant_access_token 调用(读云空间文件可能需额外授权)'
    return '尚未配置任何飞书凭据。用 feishu_config_set 配置。'
  }))

  ctx.tools.register(mk('feishu_doc_list', '列出飞书云空间文件(名称/类型/token)。需 user_access_token 才能读取个人云空间。', {
    folderToken: { type: 'string', description: '文件夹 token;不传=根目录' },
  }, [], async (args) => {
    const p = '/open-apis/drive/v1/files?page_size=20' + (args.folderToken ? '&folder_token=' + encodeURIComponent(args.folderToken) : '')
    const d = await fq('GET', p)
    const files = d.files || []
    if (!files.length) return '（无文件或无权访问,确认已填 user_access_token 并把应用加为协作者）'
    return files.map(f => `- ${f.name} [${f.file_token}] 类型:${f.type}`).join('\n')
  }))

  ctx.tools.register(mk('feishu_doc_read', '读取一个飞书 docx 文档的完整文本(标题 + 正文块)。document_id 即文档/文件的 token。', {
    documentId: { type: 'string', description: '文档 ID(文档链接中的 docx/xxx 的 xxx)' },
  }, ['documentId'], async (args) => {
    const meta = await fq('GET', '/open-apis/docx/v1/documents/' + encodeURIComponent(args.documentId))
    const title = meta.document ? meta.document.title : '(无标题)'
    let items = [], pageToken = '', pages = 0
    while (pages < 20) {
      const p = '/open-apis/docx/v1/documents/' + encodeURIComponent(args.documentId) +
        '/blocks?page_size=50' + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '')
      const d = await fq('GET', p)
      items = items.concat(d.items || [])
      if (!d.has_more || !d.page_token) break
      pageToken = d.page_token; pages++
    }
    return '# ' + title + '\n\n' + renderBlocks(items)
  }))

  ctx.tools.register(mk('feishu_doc_create', '创建一个新的空白飞书文档,返回 document_id。', {
    title: { type: 'string', description: '文档标题' },
    folderToken: { type: 'string', description: '目标文件夹 token;不传=默认位置' },
  }, ['title'], async (args) => {
    const body = { title: args.title }
    if (args.folderToken) body.folder_token = args.folderToken
    const d = await fq('POST', '/open-apis/docx/v1/documents', body)
    const id = d.document ? d.document.document_id : '(未知)'
    return '已创建文档, document_id=' + id
  }))

  ctx.tools.register(mk('feishu_doc_update', '向飞书文档追加一段文本(作为新的文本段落)。', {
    documentId: { type: 'string', description: '文档 ID' },
    content: { type: 'string', description: '要追加的文本内容' },
  }, ['documentId', 'content'], async (args) => {
    const children = [{ block_type: 2, text: { elements: [{ text_run: { content: args.content } }] } }]
    await fq('POST', '/open-apis/docx/v1/documents/' + encodeURIComponent(args.documentId) +
      '/blocks/' + encodeURIComponent(args.documentId) + '/children', { children })
    return '已追加文本到文档 ' + args.documentId
  }))

  ctx.tools.register(mk('feishu_wiki_list', '浏览飞书知识库:不传 spaceId 时列出所有知识库空间;传 spaceId 时列出该空间下的节点。', {
    spaceId: { type: 'string', description: '知识库空间 ID;不传=列出所有空间' },
  }, [], async (args) => {
    if (!args.spaceId) {
      const d = await fq('GET', '/open-apis/wiki/v2/spaces?page_size=20')
      const items = d.items || []
      if (!items.length) return '（无知识库空间,或需 user_access_token/应用授权）'
      return items.map(s => `- ${s.name} [space_id=${s.space_id}]`).join('\n')
    }
    const d = await fq('GET', '/open-apis/wiki/v2/spaces/' + encodeURIComponent(args.spaceId) + '/nodes?page_size=20')
    const items = d.items || []
    if (!items.length) return '（该空间无节点,或无权访问）'
    return items.map(n => `- ${n.title} [node=${n.node_token}, obj=${n.obj_token}, type=${n.node_type}]`).join('\n')
  }))
}
