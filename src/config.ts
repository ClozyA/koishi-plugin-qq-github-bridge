import { Schema } from 'koishi'
import { createPrivateKey } from 'node:crypto'
import { BridgeError } from './utils/errors'

export const QQ_PATTERN = /^[1-9][0-9]{4,19}$/
export const DEFAULT_TEMPLATE = '以下正文由 QQ 群成员通过 GitHub Bridge 提交。\n\n{body}'

export interface Binding {
  groupId: string
  owner: string
  repo: string
  enabled: boolean
}

export interface Config {
  authMode: 'pat' | 'app'
  token: string
  appId: string
  installationId: string
  privateKey: string
  apiBaseUrl: string
  apiVersion: string
  requestTimeout: number
  readRetries: number
  commentTemplate: string
  bindings: Binding[]
  replyPrefix: string
  replyPattern: string
  closePrefix: string
  openPrefix: string
  adminPrefix: string
  superAdmins: string[]
  enableAdminCommands: boolean
  userCooldown: number
  maxCommentLength: number
  allowMultiline: boolean
  auditEnabled: boolean
  auditRetentionDays: number
  dedupWindow: number
  confirmHighRisk: boolean
  confirmationTimeout: number
}

const prefix = (value: string, description: string) => Schema.string().default(value).description(description)
const qq = () => Schema.string().pattern(QQ_PATTERN).description('真实数字 QQ 号，按字符串填写。')

export const Config: Schema<Partial<Config>, Config> = Schema.intersect([
  Schema.object({
    authMode: Schema.union(['pat', 'app']).default('pat').description('认证方式：PAT 或 GitHub App。'),
    token: Schema.string().role('secret').default('').description('统一 GitHub Personal Access Token。支持 Fine-grained PAT；不要在 QQ 中发送。'),
    appId: Schema.string().default('').description('GitHub App 的 App ID（数字）。'),
    installationId: Schema.string().default('').description('GitHub App 安装 ID（数字），对应一个账号或组织的安装。'),
    privateKey: Schema.string().role('secret').default('').description('GitHub App PEM 私钥；单行输入框可用字面量 \\n 表示换行。请妥善保护 Koishi 配置。'),
    apiBaseUrl: Schema.string().default('https://api.github.com').description('GitHub REST API 根地址；企业版通常为 https://主机/api/v3。必须使用 HTTPS（本机测试除外）。'),
    apiVersion: Schema.string().default('2026-03-10').description('GitHub API 版本。企业版可按服务器支持情况修改。'),
    requestTimeout: Schema.number().min(1000).max(60000).step(1).default(15000).description('单次请求超时（毫秒）。写入不会自动重试。'),
    readRetries: Schema.number().min(0).max(3).step(1).default(2).description('只读请求遇到网络故障或 5xx 时的重试次数。'),
    commentTemplate: Schema.string().role('textarea').default(DEFAULT_TEMPLATE).description('正文模板，必须且只能包含一次 {body}。固定身份头由插件生成，不可覆盖；原始正文原样替换。'),
  }).description('GitHub 设置'),
  Schema.object({
    bindings: Schema.array(Schema.object({
      groupId: qq().description('QQ群号；一个群仅能出现一次。'),
      owner: Schema.string().required().description('仓库所属用户或组织，不填 URL。'),
      repo: Schema.string().required().description('仓库名称，不填 URL 或 owner/。'),
      enabled: Schema.boolean().default(true).description('启用此群的仓库绑定。'),
    })).role('table').default([]).description('多个群可绑定同一仓库；未绑定或禁用的群完全忽略。'),
  }).description('仓库绑定'),
  Schema.object({
    replyPrefix: prefix('re', '普通评论前缀，例如 re1003 内容。'),
    replyPattern: Schema.string().role('textarea').default('').description('留空使用回复前缀。自定义 RE2 表达式须以 ^ 开始、$ 结束，并有命名组 (?<number>...) 和 (?<body>...)。不支持回溯引用与前后查找；固定使用 u 模式。'),
    closePrefix: prefix('close', '关闭前缀，例如 close1003。'),
    openPrefix: prefix('open', '重开前缀，例如 open1003。'),
    adminPrefix: prefix('ghadmin', '管理员指令前缀，例如 ghadmin add 123456789。二次确认使用此前缀 confirm 确认码。'),
  }).description('命令设置'),
  Schema.object({
    superAdmins: Schema.array(qq()).min(1).required().description('至少配置一个超级管理员 QQ。通过本页恢复控制权；QQ 指令不能撤销。'),
    enableAdminCommands: Schema.boolean().default(true).description('允许在已绑定群使用管理员新增、撤销和列表命令。'),
  }).description('独立权限设置'),
  Schema.object({
    userCooldown: Schema.number().min(0).max(3600000).step(1).default(5000).description('每位 QQ 用户的操作冷却（毫秒），跨群共用；确认指令不额外冷却。'),
    maxCommentLength: Schema.number().min(1).max(30000).step(1).default(6000).description('评论正文最大字符长度（UTF-16 单元）。'),
    allowMultiline: Schema.boolean().default(true).description('允许多行评论和 Markdown。'),
    auditEnabled: Schema.boolean().default(true).description('保存操作审计到 Koishi 数据库；不存 Token、昵称或评论正文。'),
    auditRetentionDays: Schema.number().min(1).max(365).step(1).default(30).description('审计保留天数，每小时自动清理过期记录。'),
    dedupWindow: Schema.number().min(300000).max(604800000).step(1).default(86400000).description('消息去重时间窗口（毫秒），默认 24 小时。过期事件不执行；记录跨重启保留。'),
    confirmHighRisk: Schema.boolean().default(true).description('关闭、重开、新增和撤销管理员前要求同一 QQ、同一群在限时内确认。'),
    confirmationTimeout: Schema.number().min(10000).max(300000).step(1).default(60000).description('高风险操作确认有效期（毫秒）；重载后失效。'),
  }).description('安全与可靠性'),
])

export function validateConfig(config: Config) {
  const invalid = (message: string): never => { throw new BridgeError('config', message) }
  if (config.authMode === 'pat') {
    if (!config.token || config.token.length > 16384 || /\s|[^\x21-\x7e]/.test(config.token)) invalid('请在后台填写有效格式的 GitHub Token（不可为空或包含空白）。')
  } else if (config.authMode === 'app') {
    if (!/^[1-9]\d{0,19}$/.test(config.appId) || !/^[1-9]\d{0,19}$/.test(config.installationId)) invalid('请填写有效的 GitHub App ID 和安装 ID。')
    try {
      if (config.privateKey.length > 16384 || createPrivateKey(config.privateKey.replace(/\\n/g, '\n')).asymmetricKeyType !== 'rsa') invalid('GitHub App 私钥必须是有效的 RSA PEM 私钥。')
    } catch { invalid('GitHub App 私钥必须是有效的 RSA PEM 私钥。') }
  } else {
    invalid('请选择有效的 GitHub 认证方式。')
  }
  let base: URL
  try { base = new URL(config.apiBaseUrl) } catch { return invalid('GitHub API 地址不是有效 URL。') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) invalid('GitHub API 必须使用 HTTPS。')
  if (base.username || base.password || base.search || base.hash) invalid('GitHub API 地址不得包含用户名、密码、查询参数或片段。')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.apiVersion)) invalid('API 版本必须采用 YYYY-MM-DD 格式。')
  const prefixes = [config.replyPrefix, config.closePrefix, config.openPrefix, config.adminPrefix]
  if (prefixes.some(value => !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value))) invalid('指令前缀须以英文字母开头，最多 32 位，仅含英文字母、数字、下划线和连字符。')
  if (prefixes.some((p, i) => prefixes.some((q, j) => i !== j && p.startsWith(q)))) invalid('指令前缀不得相同或互为前缀。')
  if (!config.superAdmins.length || config.superAdmins.some(id => !QQ_PATTERN.test(id))) invalid('必须配置至少一个有效的超级管理员 QQ。')
  if (new Set(config.superAdmins).size !== config.superAdmins.length) invalid('超级管理员列表存在重复 QQ。')
  const groups = new Set<string>()
  if (config.bindings.length > 500) invalid('最多允许配置 500 个群绑定。')
  for (const binding of config.bindings) {
    if (!QQ_PATTERN.test(binding.groupId)) invalid('群绑定中存在无效的 QQ 群号。')
    if (groups.has(binding.groupId)) invalid('同一 QQ 群只能绑定一次。')
    groups.add(binding.groupId)
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(binding.owner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(binding.repo) || ['.', '..'].includes(binding.repo)) invalid('仓库 Owner 或名称不合法；请分别填写名称，不要填写 URL。')
  }
  if (config.commentTemplate.length > 4000 || config.commentTemplate.split('{body}').length !== 2) invalid('评论模板最多 4000 字符，并且必须且只能包含一次 {body}。')
  if (/\{(?!body\})[^{}]*\}/.test(config.commentTemplate)) invalid('评论模板仅支持 {body} 占位符。')
  if ((config.token && config.commentTemplate.includes(config.token)) || (config.privateKey && (config.commentTemplate.includes(config.privateKey) || config.commentTemplate.includes(config.privateKey.replace(/\\n/g, '\n'))))) invalid('评论模板不能包含 GitHub 凭据。')
  return config
}
