import { Context } from 'koishi'

declare module 'koishi' {
  interface Tables {
    pig_user_state: PigUserState
    pig_travel_log: PigTravelLog
    pig_guild_config: PigGuildConfig
  }
}

export interface PigUserState {
  id: number
  userId: string
  platform: string
  guildId: string
  lastWakeUp: Date
  lastSunrise: Date
  latitude?: number
  longitude?: number
  abnormalCount: number
  // 熬夜统计（独立于作息异常）
  nightOwlCount: number
  lastNightOwlDate?: Date
  // 消息统计
  totalMessageCount: number
  nightMessageCount: number  // 深夜消息数
  hourlyMessageCounts: string  // JSON: {"0": 5, "1": 3, ...} 各小时消息数
  // 自定义背景
  backgroundImage?: string
}

export interface PigTravelLog {
  id: number
  userId: string
  platform: string
  guildId: string
  timestamp: Date
  country: string
  countryZh: string
  location: string
  locationZh: string
  timezone: string
  imagePath: string
  isAIGC: boolean
}

// 群组配置表（用于存储群级别的设置，如统一背景图）
export interface PigGuildConfig {
  id: number
  platform: string
  guildId: string
  // 群组统一背景图（仅管理员可设置）
  backgroundImage?: string
  // 设置背景的管理员ID
  backgroundSetBy?: string
  // 设置时间
  backgroundSetAt?: Date
}

export function applyDatabase(ctx: Context) {
  ctx.model.extend('pig_user_state', {
    id: 'unsigned',
    userId: 'string',
    platform: 'string',
    guildId: 'string',
    lastWakeUp: 'timestamp',
    lastSunrise: 'timestamp',
    latitude: 'float',
    longitude: 'float',
    abnormalCount: 'unsigned',
    nightOwlCount: 'unsigned',
    lastNightOwlDate: 'timestamp',
    totalMessageCount: 'unsigned',
    nightMessageCount: 'unsigned',
    hourlyMessageCounts: 'text',
    backgroundImage: 'string',
  }, { primary: 'id', autoInc: true })

  ctx.model.extend('pig_travel_log', {
    id: 'unsigned',
    userId: 'string',
    platform: 'string',
    guildId: 'string',
    timestamp: 'timestamp',
    country: 'string',
    countryZh: 'string',
    location: 'string',
    locationZh: 'string',
    timezone: 'string',
    imagePath: 'string',
    isAIGC: 'boolean',
  }, { primary: 'id', autoInc: true })

  // 群组配置表
  ctx.model.extend('pig_guild_config', {
    id: 'unsigned',
    platform: 'string',
    guildId: 'string',
    backgroundImage: 'string',
    backgroundSetBy: 'string',
    backgroundSetAt: 'timestamp',
  }, { primary: 'id', autoInc: true })
}
