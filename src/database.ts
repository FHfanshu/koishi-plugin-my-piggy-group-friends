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
  lastWakeUp: Date
  lastSunrise: Date
  latitude?: number
  longitude?: number
}

export interface PigTravelLog {
  id: number
  userId: string
  platform: string
  timestamp: Date
  country: string
  location: string
  timezone: string
  imagePath: string
  isAIGC: boolean
}

export function applyDatabase(ctx: Context) {
  ctx.model.extend('pig_user_state', {
    id: 'unsigned',
    userId: 'string',
    platform: 'string',
    lastWakeUp: 'timestamp',
    lastSunrise: 'timestamp',
    latitude: 'float',
    longitude: 'float',
  }, { primary: 'id', autoInc: true })

  ctx.model.extend('pig_travel_log', {
    id: 'unsigned',
    userId: 'string',
    platform: 'string',
    timestamp: 'timestamp',
    country: 'string',
    location: 'string',
    timezone: 'string',
    imagePath: 'string',
    isAIGC: 'boolean',
  }, { primary: 'id', autoInc: true })
}
