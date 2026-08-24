/**
 * dsh-wb-ui — WorkBuddy 工作台 UI 入口（宿主端）。
 *
 * 这是一个「纯 UI」插件：真正的工作在浏览器客户端（lib/client.js）完成——
 * 它在对话输入框左侧注册一个「🧰 WorkBuddy」启动按钮，点击后弹出面板，
 * 列出助理 / 项目 / 专家 / 技能 / 连接器 / 自动化 / 资料库 / 飞书文档 八大功能，
 * 每个功能带快捷操作，点击后把对应指令填入输入框并提交，由已安装的
 * dsh-wb-* 工具插件执行。
 *
 * 宿主端不需要任何服务，仅作为 bundle 挂载点。
 */
export const name = 'dsh-wb-ui'

export const inject = []

export function apply() {
  // 宿主端无逻辑；UI 完全由客户端 bundle 提供。
}
