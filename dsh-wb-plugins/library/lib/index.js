/**
 * dsh-wb-library — 参考 WorkBuddy 的「资料库」功能。
 * 管理资料库(Library)与文档(Doc)。文档含标题、正文、标签,支持按资料库浏览与全文检索。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'wb-library'

const DATA_DIR = path.join(os.homedir(), '.dsh', 'wb')
const LF = path.join(DATA_DIR, 'libraries.json')
const DF = path.join(DATA_DIR, 'docs.json')

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }) }
function readL() { ensure(); try { return JSON.parse(fs.readFileSync(LF, 'utf8')) } catch { return [] } }
function readD() { ensure(); try { return JSON.parse(fs.readFileSync(DF, 'utf8')) } catch { return [] } }
function writeL(l) { ensure(); fs.writeFileSync(LF, JSON.stringify(l, null, 2)) }
function writeD(l) { ensure(); fs.writeFileSync(DF, JSON.stringify(l, null, 2)) }

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
    name: 'wb-library', order: 125,
    text: '你拥有 WorkBuddy 风格的资料库:library_create/list 管理资料库,doc_add/list/get/search/delete 管理文档。' +
      '需要引用既有资料、沉淀知识或检索历史文档时优先使用这些工具;doc_search 支持标题与正文全文检索。',
  })

  ctx.tools.register(mk('library_create', '创建一个资料库。', {
    name: { type: 'string', description: '资料库名称' },
    description: { type: 'string', description: '资料库描述' },
  }, ['name'], (args) => {
    const l = readL()
    const lib = { id: crypto.randomUUID().slice(0, 8), name: args.name, description: args.description || '', createdAt: new Date().toISOString() }
    l.push(lib); writeL(l)
    return `已创建资料库 "${lib.name}" (${lib.id})。`
  }))

  ctx.tools.register(mk('library_list', '列出所有资料库(附文档数)。', {}, [], () => {
    const ls = readL(); const ds = readD()
    if (!ls.length) return '（暂无资料库）用 library_create 创建。'
    return ls.map(l => `- ${l.name} [${l.id}]  文档数:${ds.filter(d => d.libraryId === l.id).length}`).join('\n')
  }))

  ctx.tools.register(mk('doc_add', '向资料库添加一篇文档。', {
    libraryId: { type: 'string', description: '所属资料库 id' },
    title: { type: 'string', description: '文档标题' },
    content: { type: 'string', description: '文档正文' },
    tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
  }, ['libraryId', 'title', 'content'], (args) => {
    if (!readL().find(l => l.id === args.libraryId)) return '资料库不存在: ' + args.libraryId
    const l = readD()
    const d = { id: crypto.randomUUID().slice(0, 8), libraryId: args.libraryId, title: args.title, content: args.content || '', tags: args.tags || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    l.push(d); writeD(l)
    return `已添加文档 "${d.title}" [${d.id}]`
  }))

  ctx.tools.register(mk('doc_list', '列出某资料库下的文档(标题/标签)。', {
    libraryId: { type: 'string', description: '资料库 id' },
  }, ['libraryId'], (args) => {
    const ds = readD().filter(d => d.libraryId === args.libraryId)
    if (!ds.length) return '该资料库暂无文档。'
    return ds.map(d => `- ${d.title} [${d.id}]  标签:${(d.tags || []).join(',') || '(无)'}`).join('\n')
  }))

  ctx.tools.register(mk('doc_get', '读取文档完整内容。', {
    id: { type: 'string', description: '文档 id' },
  }, ['id'], (args) => {
    const d = readD().find(x => x.id === args.id)
    if (!d) return '未找到文档: ' + args.id
    return `# ${d.title}\n标签: ${(d.tags || []).join(', ') || '(无)'}\n\n${d.content}`
  }))

  ctx.tools.register(mk('doc_search', '在资料库中全文检索文档(匹配标题或正文,返回命中片段与文档 id)。', {
    query: { type: 'string', description: '检索关键词' },
    libraryId: { type: 'string', description: '限定资料库;不传=全部资料库' },
  }, ['query'], (args) => {
    const q = args.query.toLowerCase()
    let ds = readD()
    if (args.libraryId) ds = ds.filter(d => d.libraryId === args.libraryId)
    const hits = ds.filter(d => (d.title + ' ' + d.content).toLowerCase().includes(q))
    if (!hits.length) return '未检索到匹配文档: ' + args.query
    return hits.map(d => {
      const idx = d.content.toLowerCase().indexOf(q)
      const snip = idx < 0 ? d.content.slice(0, 120) : d.content.slice(Math.max(0, idx - 40), idx + 80)
      return `- ${d.title} [${d.id}]\n  …${snip.replace(/\n/g, ' ')}…`
    }).join('\n')
  }))

  ctx.tools.register(mk('doc_delete', '删除一篇文档。', {
    id: { type: 'string', description: '文档 id' },
  }, ['id'], (args) => {
    const l = readD(); const i = l.findIndex(x => x.id === args.id)
    if (i < 0) return '未找到文档: ' + args.id
    const [rm] = l.splice(i, 1); writeD(l)
    return `已删除文档 "${rm.title}"。`
  }))
}
