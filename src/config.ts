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
  backgroundStoragePath: string
  // LLM location generation
  llmLocationEnabled: boolean
  llmLocationModel: string
  llmLocationCustomContext: string
  // Image Search
  imageSearchPrompt: string
  // Unsplash API
  unsplashAccessKey: string
  // Pexels API
  pexelsApiKey: string
  // Background fetch behavior
  backgroundFetchMode: 'auto' | 'always' | 'never'
  backgroundFetchTimeoutMs: number
  // Travel log retention
  logRetentionDays: number
  // Monthly summary
  monthlySummaryEnabled: boolean
  monthlySummaryScope: 'global' | 'guild'
  // Auto wake-up detection (experimental)
  experimentalAutoDetect: boolean
  // Night owl detection (熬夜检测)
  nightOwlEnabled: boolean
  nightOwlStartHour: number
  nightOwlEndHour: number
  nightOwlGrayscaleAvatar: boolean
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
    llmLocationCustomContext: Schema.string().role('textarea').default('').description('自定义生成上下文（如：关注北欧神话、赛博朋克风格建筑等，留空则完全随机）'),
    imageSearchPrompt: Schema.string().default('{landmark} {country} landscape').description('搜图关键词模板（可用变量：{landmark} 地标英文名, {country} 国家英文名, {city} 城市英文名）'),
    unsplashAccessKey: Schema.string().role('secret').default('').description('Unsplash API Access Key (可选)'),
    pexelsApiKey: Schema.string().role('secret').default('').description('Pexels API Key (可选，作为 Unsplash 的补充)'),
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
    nightOwlEnabled: Schema.boolean().default(true).description('启用熬夜检测（在深夜时段发消息会被记录）'),
    nightOwlStartHour: Schema.number().default(0).description('熬夜时段开始（0-23，默认 0 点）'),
    nightOwlEndHour: Schema.number().default(5).description('熬夜时段结束（0-23，默认 5 点）'),
    nightOwlGrayscaleAvatar: Schema.boolean().default(false).description('熬夜榜头像是否使用黑白滤镜（默认为否，显示彩色）'),
  }).description('熬夜检测 🦉'),

  Schema.object({
    useStorageService: Schema.boolean().default(true).description('使用 chatluna-storage-service 缓存图片（推荐）'),
    storageCacheHours: Schema.number().default(24).description('图片缓存时间（小时）'),
    logRetentionDays: Schema.number().default(45).description('旅行记录保留天数'),
    monthlySummaryEnabled: Schema.boolean().default(false).description('每月1日自动生成上月旅行总结'),
    monthlySummaryScope: Schema.union([
      Schema.const('global').description('全局合并（跨群统计）'),
      Schema.const('guild').description('按群分开统计'),
    ]).default('global').description('月度总结统计范围'),
    logPath: Schema.string().default('./data/pig/logs').description('本地日志存储路径（仅在不使用存储服务时生效）'),
    backgroundStoragePath: Schema.string().default('./data/pig/backgrounds').description('自定义背景图片存储路径'),
  }).description('存储设置 💾'),

  Schema.object({
    debug: Schema.boolean().default(false).description('输出详细调试日志'),
  }).description('调试'),
])
