import { Context } from 'koishi'

declare module 'koishi' {
  interface Tables {
    pig_user_state: PigUserState
    pig_travel_log: PigTravelLog
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
}
