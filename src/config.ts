import { Schema } from 'koishi'

export interface Config {
  sunriseApi: string
  defaultLat: number
  defaultLng: number
  abnormalThreshold: number
  outputMode: 'text' | 'image'
  useStorageService: boolean
  storageCacheHours: number
  travelMessageTemplate: string
  aigcEnabled: boolean
  aigcChannel: string
  aigcPrompt: string
  logPath: string
  // LLM location generation
  llmLocationEnabled: boolean
  llmLocationModel: string
  // Unsplash API
  unsplashAccessKey: string
  // Background fetch behavior
  backgroundFetchMode: 'auto' | 'always' | 'never'
  backgroundFetchTimeoutMs: number
  // Travel log retention
  logRetentionDays: number
  // Auto wake-up detection (experimental)
  experimentalAutoDetect: boolean
  // Debug
  debug: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    outputMode: Schema.union(['text', 'image']).default('image').description('输出模式：text 纯文本，image 生成精美卡片'),
    travelMessageTemplate: Schema.string().default('去了 {landmark}，{country}！📸').description('旅行消息模板（可用变量：{landmark} 地标名, {country} 国家名）'),
  }).description('基础设置'),

  Schema.object({
    llmLocationEnabled: Schema.boolean().default(false).description('启用后使用 LLM 动态生成全球旅行地点，关闭则使用预设地点库'),
    llmLocationModel: Schema.dynamic('model').description('用于生成地点的模型（推荐使用快速模型如 gemini-flash）'),
    unsplashAccessKey: Schema.string().role('secret').default('').description('用于获取高质量风景背景图（从 unsplash.com/developers 免费申请）'),
    backgroundFetchMode: Schema.union([
      Schema.const('auto').description('自动：尽量内联远程图片，遇到易超时域名则直接使用 URL'),
      Schema.const('always').description('强制服务端拉取并内联（更稳但可能慢）'),
      Schema.const('never').description('不进行服务端拉取，直接使用 URL'),
    ]).default('auto').description('背景图服务端拉取策略'),
    backgroundFetchTimeoutMs: Schema.number().default(8000).description('背景图服务端拉取超时（毫秒）'),
  }).description('地点与图片 🌍'),

  Schema.object({
    aigcEnabled: Schema.boolean().default(false).description('启用后使用 AI 生成小猪旅行插画（需要 media-luna 插件）'),
    aigcChannel: Schema.string().default('').description('media-luna 渠道名称'),
    aigcPrompt: Schema.string().role('textarea').default('一个可爱的卡通小猪正在 {country} 的 {landmark} 前面自拍，阳光明媚，旅游照片风格').description('AI 生图提示词模板'),
  }).description('AI 生图（可选）🎨'),

  Schema.object({
    experimentalAutoDetect: Schema.boolean().default(false).description('自动检测用户首条消息并判断作息是否异常'),
    sunriseApi: Schema.string().default('https://api.sunrise-sunset.org/json').description('日出日落 API 地址'),
    defaultLat: Schema.number().default(30).description('默认纬度（北纬为正）'),
    defaultLng: Schema.number().default(120).description('默认经度（东经为正）'),
    abnormalThreshold: Schema.number().default(3).description('作息异常判定阈值（小时）'),
  }).description('自动检测（实验性）🧪'),

  Schema.object({
    useStorageService: Schema.boolean().default(true).description('使用 chatluna-storage-service 缓存图片（推荐）'),
    storageCacheHours: Schema.number().default(24).description('图片缓存时间（小时）'),
    logRetentionDays: Schema.number().default(45).description('旅行记录保留天数'),
    logPath: Schema.string().default('./data/pig/logs').description('本地日志存储路径（仅在不使用存储服务时生效）'),
  }).description('存储设置 💾'),

  Schema.object({
    debug: Schema.boolean().default(false).description('输出详细调试日志'),
  }).description('调试'),
])
