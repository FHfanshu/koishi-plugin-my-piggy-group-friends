import { Schema } from 'koishi'

export interface Config {
  /** @deprecated 已废弃，仅用于兼容旧配置，不再生效 */
  sunriseApi?: string
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
  /** @deprecated 已废弃，仅用于兼容旧配置，不再生效 */
  logPath?: string
  backgroundStoragePath: string
  // LLM location generation
  llmLocationEnabled: boolean
  llmLocationModel: string
  llmLocationCustomContext: string
  llmFailureCooldownMs: number
  // Image Search
  imageSearchPrompt: string
  // Unsplash API
  unsplashAccessKey: string
  // Pexels API
  pexelsApiKey: string
  // Background fetch behavior
  backgroundFetchMode: 'auto' | 'always' | 'never'
  backgroundFetchTimeoutMs: number
  backgroundInlineMaxBytes: number
  // World map rendering
  worldMapUseTianditu: boolean
  tiandituToken: string
  tiandituTimeoutMs: number
  worldMapOfficialOnly: boolean
  // Travel log retention
  logRetentionDays: number
  // Monthly summary
  monthlySummaryEnabled: boolean
  monthlySummaryScope: 'global' | 'guild'
  // Auto wake-up detection (experimental)
  experimentalAutoDetect: boolean
  experimentalAutoDetectScope: 'guild' | 'all'
  // Silent record (after sunrise first message)
  silentRecordEnabled: boolean
  silentRecordAutoTravel: boolean
  // Night owl detection (熬夜检测)
  nightOwlEnabled: boolean
  nightOwlStartHour: number
  nightOwlEndHour: number
  nightOwlGrayscaleAvatar: boolean
  // Debug
  debug: boolean
}

const llmLocationDisabledSchema = Schema.object({
  llmLocationEnabled: Schema.const(false).default(false).description('关闭：使用预设地点库'),
})

const llmLocationEnabledSchema = Schema.object({
  llmLocationEnabled: Schema.const(true).description('开启：使用 LLM 动态生成地点'),
  llmLocationModel: Schema.dynamic('model').description('用于生成地点的模型（推荐使用快速模型如 gemini-flash）'),
  llmLocationCustomContext: Schema.string().role('textarea').default('').description('自定义生成上下文（可留空）'),
  llmFailureCooldownMs: Schema.number().default(300000).description('LLM 调用失败冷却时间（毫秒）'),
  imageSearchPrompt: Schema.string().default('{landmark} {country} landscape').description('搜图关键词模板（可用变量：{landmark} {country} {city}）'),
  unsplashAccessKey: Schema.string().role('secret').default('').description('Unsplash API Access Key（可选）'),
  pexelsApiKey: Schema.string().role('secret').default('').description('Pexels API Key（可选）'),
})

const aiImageDisabledSchema = Schema.object({
  aigcEnabled: Schema.const(false).default(false).description('关闭：不使用 AI 生图'),
})

const aiImageEnabledSchema = Schema.object({
  aigcEnabled: Schema.const(true).description('开启：使用 AI 生成旅行插画（需要 media-luna）'),
  aigcChannel: Schema.string().default('').description('media-luna 渠道名称'),
  aigcPrompt: Schema.string().role('textarea').default('一个可爱的卡通小猪正在 {country} 的 {landmark} 前面自拍，阳光明媚，旅游照片风格').description('AI 生图提示词模板'),
})

const worldMapConfigSchema = Schema.union([
  Schema.object({
    worldMapUseTianditu: Schema.const(false).description('关闭：不叠加天地图底图'),
    worldMapOfficialOnly: Schema.boolean().default(false).description('强制仅展示官方底图，不做足迹填色高亮'),
  }),
  Schema.object({
    worldMapUseTianditu: Schema.const(true).default(true).description('开启：浏览器直连天地图底图（失败自动回退）'),
    tiandituToken: Schema.string().role('secret').default('').description('天地图 Token（留空则不启用）'),
    tiandituTimeoutMs: Schema.number().default(5000).description('天地图底图加载超时（毫秒）'),
    worldMapOfficialOnly: Schema.boolean().default(false).description('强制仅展示官方底图，不做足迹填色高亮'),
  }),
]).description('世界地图 🗺️')

const autoDetectDisabledSchema = Schema.object({
  experimentalAutoDetect: Schema.const(false).default(false).description('关闭：不自动检测作息异常'),
})

const autoDetectEnabledSchema = Schema.object({
  experimentalAutoDetect: Schema.const(true).description('开启：自动检测作息异常'),
  experimentalAutoDetectScope: Schema.union([
    Schema.const('guild').description('仅群聊消息触发'),
    Schema.const('all').description('群聊与私聊均触发'),
  ]).default('guild').description('自动检测触发范围'),
  abnormalThreshold: Schema.number().default(3).description('作息异常判定阈值（小时）'),
})

const nightOwlDisabledSchema = Schema.object({
  nightOwlEnabled: Schema.const(false).description('关闭：不统计熬夜行为'),
})

const nightOwlEnabledSchema = Schema.object({
  nightOwlEnabled: Schema.const(true).default(true).description('开启：统计熬夜行为'),
  nightOwlStartHour: Schema.number().default(0).description('熬夜时段开始（0-23）'),
  nightOwlEndHour: Schema.number().default(5).description('熬夜时段结束（0-23）'),
  nightOwlGrayscaleAvatar: Schema.boolean().default(false).description('熬夜榜头像使用黑白滤镜'),
})

const storageServiceDisabledSchema = Schema.object({
  useStorageService: Schema.const(false).description('关闭：不使用存储服务，回退 base64'),
})

const storageServiceEnabledSchema = Schema.object({
  useStorageService: Schema.const(true).default(true).description('开启：使用 chatluna-storage-service 缓存图片'),
  storageCacheHours: Schema.number().default(24).description('图片缓存时间（小时）'),
})

const deprecatedCompatSchema = Schema.object({
  sunriseApi: Schema.string().hidden().deprecated().description('已废弃：当前版本不再使用'),
  logPath: Schema.string().hidden().deprecated().description('已废弃：当前版本不再使用'),
}).hidden()

export const Config = Schema.intersect([
  Schema.object({
    outputMode: Schema.union(['text', 'image']).default('image').description('输出模式：text 纯文本，image 生成精美卡片'),
    travelMessageTemplate: Schema.string().default('去了 {landmark}，{country}！📸').description('旅行消息模板（可用变量：{landmark} 地标名, {country} 国家名）'),
  }).description('基础设置'),

  Schema.union([
    llmLocationDisabledSchema,
    llmLocationEnabledSchema,
  ]).description('地点生成 🌍'),

  Schema.object({
    backgroundFetchMode: Schema.union([
      Schema.const('auto').description('自动：尽量内联远程图片，遇到易超时域名则直接使用 URL'),
      Schema.const('always').description('强制服务端拉取并内联（更稳但可能慢）'),
      Schema.const('never').description('不进行服务端拉取，直接使用 URL'),
    ]).default('auto').description('背景图服务端拉取策略'),
    backgroundFetchTimeoutMs: Schema.number().default(8000).description('背景图服务端拉取超时（毫秒）'),
    backgroundInlineMaxBytes: Schema.number().default(8 * 1024 * 1024).description('背景图内联为 data URL 的最大字节数（过大将回退为远程 URL）'),
    backgroundStoragePath: Schema.string().default('./data/pig/backgrounds').description('自定义背景图片存储路径'),
  }).description('图片与背景 🖼️'),

  worldMapConfigSchema,

  Schema.union([
    aiImageDisabledSchema,
    aiImageEnabledSchema,
  ]).description('AI 生图 🎨'),

  Schema.intersect([
    Schema.union([
      autoDetectDisabledSchema,
      autoDetectEnabledSchema,
    ]),
    Schema.object({
      defaultLat: Schema.number().default(30).description('默认纬度（北纬为正）'),
      defaultLng: Schema.number().default(120).description('默认经度（东经为正）'),
    }),
  ]).description('作息检测'),

  Schema.object({
    silentRecordEnabled: Schema.boolean().default(true).description('启用后台静默记录用户起床时间'),
    silentRecordAutoTravel: Schema.boolean().default(false).description('静默记录时同时触发虚拟旅行卡片'),
  }).description('静默记录'),

  Schema.union([
    nightOwlDisabledSchema,
    nightOwlEnabledSchema,
  ]).description('熬夜检测 🦉'),

  Schema.union([
    storageServiceDisabledSchema,
    storageServiceEnabledSchema,
  ]).description('存储服务 💾'),

  Schema.object({
    logRetentionDays: Schema.number().default(45).description('旅行记录保留天数'),
    monthlySummaryEnabled: Schema.boolean().default(false).description('是否启用每月自动生成上月旅行总结（不影响手动命令 pig.summary）'),
    monthlySummaryScope: Schema.union([
      Schema.const('global').description('全局合并（跨群统计）'),
      Schema.const('guild').description('按群分开统计'),
    ]).default('global').description('月度总结统计范围'),
  }).description('数据与月报'),

  deprecatedCompatSchema,

  Schema.object({
    debug: Schema.boolean().default(false).description('输出详细调试日志'),
  }).description('调试'),
]) as unknown as Schema<Config>
