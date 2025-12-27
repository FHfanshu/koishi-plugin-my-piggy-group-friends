import { Context, segment } from 'koishi'
import {} from 'koishi-plugin-cron'
import './types'
import { Config } from './config'
import { applyDatabase } from './database'
import { getSunriseInfo } from './services/sunrise'
import { triggerTravelSequence, TravelResult, UserInfo } from './services/travel'

export const name = 'my-pig-group-friends'
export const inject = {
  required: ['database', 'cron', 'puppeteer'],
  optional: ['mediaLuna', 'chatluna_storage', 'chatluna']
}
export * from './config'

// 格式化旅行结果消息
function formatTravelMessage(result: TravelResult, userId: string, config: Config): string {
  if (config.outputMode === 'text') {
    return `${segment.at(userId)} ${result.msg}`
  }

  // 图片模式
  // 优先使用存储服务返回的 URL
  if (result.imageUrl) {
    return `${segment.at(userId)} ${result.msg}\n${segment.image(result.imageUrl)}`
  }

  // 回退到 base64（当存储服务不可用时）
  if (result.imageBuffer) {
    const base64 = result.imageBuffer.toString('base64')
    return `${segment.at(userId)} ${result.msg}\n${segment.image(`base64://${base64}`)}`
  }

  // 无图片时只发文本
  return `${segment.at(userId)} ${result.msg}`
}

export function apply(ctx: Context, config: Config) {
  ctx.logger('pig').info('my-pig-group-friends plugin is loading...')
  applyDatabase(ctx)

  // 检查存储服务状态
  if (config.useStorageService && !ctx.chatluna_storage) {
    ctx.logger('pig').warn('useStorageService 已启用但 chatluna_storage 服务不可用，将回退到 base64 模式')
  }

  // 用于防止重复触发的锁（用户ID -> 锁定时间戳）
  const travelLocks = new Map<string, number>()
  const LOCK_DURATION_MS = 60 * 1000 // 60秒锁定期

  ctx.command('pig [user:user]', '虚拟旅行')
    .alias('猪醒')
    .action(async ({ session }, user) => {
      // 如果没有指定用户，默认使用发送者自己
      let platform: string
      let userId: string
      if (user) {
        [platform, userId] = user.split(':')
      } else {
        platform = session.platform
        userId = session.userId
      }

      // Try to get user info from session if targeting self, otherwise use basic info
      let userInfo: UserInfo
      if (session?.userId === userId) {
        userInfo = {
          userId,
          username: session.author?.nickname || session.author?.name || session.username || userId,
          avatarUrl: session.author?.avatar || ''
        }
      } else {
        // For target user, try to get avatar and nickname using platform-specific API
        let avatarUrl = ''
        let username = userId

        try {
          if (platform === 'onebot') {
            // QQ platform: use QQ avatar API directly
            avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`
          }

          // Try to fetch actual nickname/name
          if (session.bot) {
            if (session.guildId && session.bot.getGuildMember) {
              try {
                const member = await session.bot.getGuildMember(session.guildId, userId)
                username = member.nick || member.name || member.user?.name || username
                avatarUrl = avatarUrl || member.user?.avatar || ''
              } catch (e) {
                // Ignore guild member fetch error
              }
            }

            if (username === userId && session.bot.getUser) {
              try {
                const user = await session.bot.getUser(userId)
                username = user.name || username
                avatarUrl = avatarUrl || user.avatar || ''
              } catch (e) {
                // Ignore user fetch error
              }
            }
          }
        } catch (e) {
          ctx.logger('pig').warn(`Failed to fetch metadata for user ${userId}: ${e}`)
        }

        userInfo = {
          userId,
          username,
          avatarUrl
        }
      }

      const result = await triggerTravelSequence(ctx, config, userInfo, platform)
      return formatTravelMessage(result, userId, config)
    })

  ctx.middleware(async (session, next) => {
    // 如果没有开启实验性自动检测功能，直接跳过
    if (!config.experimentalAutoDetect) return next()

    if (!session.userId || !session.content) return next()

    const lockKey = `${session.platform}:${session.userId}`
    const now = Date.now()

    // 检查是否处于锁定期（防止短时间内多条消息重复触发）
    const lockTime = travelLocks.get(lockKey)
    if (lockTime && now - lockTime < LOCK_DURATION_MS) {
      if (config.debug) {
        ctx.logger('pig').debug(`用户 ${session.userId} 处于锁定期，跳过自动检测`)
      }
      return next()
    }

    const nowDate = new Date()
    const [userState] = await ctx.database.get('pig_user_state', {
      userId: session.userId,
      platform: session.platform,
    })

    const lat = userState?.latitude ?? config.defaultLat
    const lng = userState?.longitude ?? config.defaultLng

    try {
      const sunriseInfo = await getSunriseInfo(ctx, lat, lng)
      const dayStart = new Date(sunriseInfo.sunrise.getTime() - 2 * 60 * 60 * 1000) // 2 hours before sunrise

      if (nowDate >= dayStart && (!userState?.lastWakeUp || userState.lastWakeUp < dayStart)) {
        // 立即更新状态，防止后续消息重复触发
        await ctx.database.upsert('pig_user_state', [{
          userId: session.userId,
          platform: session.platform,
          lastWakeUp: nowDate,
          lastSunrise: sunriseInfo.sunrise,
        }], ['platform', 'userId'])

        // This is the first message of the day
        if (userState?.lastWakeUp) {
          const diffHours = Math.abs((nowDate.getTime() - userState.lastWakeUp.getTime() - 24 * 60 * 60 * 1000) / (1000 * 60 * 60))

          if (diffHours > config.abnormalThreshold) {
            // 设置锁定，防止重复触发
            travelLocks.set(lockKey, now)

            // Trigger Travel Sequence
            await session.send(`检测到 ${segment.at(session.userId)} 作息异常（差异: ${diffHours.toFixed(1)}小时），准备虚拟旅行...`)

            const userInfo: UserInfo = {
              userId: session.userId,
              username: session.author?.nickname || session.author?.name || session.username || session.userId,
              avatarUrl: session.author?.avatar || ''
            }

            const result = await triggerTravelSequence(ctx, config, userInfo, session.platform)
            await session.send(formatTravelMessage(result, session.userId, config))
          }
        }
      }
    } catch (e) {
      ctx.logger('pig').error('Failed to process wake-up detection:', e)
    }

    return next()
  })

  // Monthly Travel Handbook
  ctx.cron('0 0 1 * *', async () => {
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    ctx.logger('pig').info('Generating monthly travel handbook...')

    // Logic to fetch all logs from lastMonth, generate long image summary,
    // and send to respective users/groups.
    // (Actual image stitching will be implemented later with Canvas)
  })

  // Daily cleanup of old travel logs
  ctx.cron('0 3 * * *', async () => {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - config.logRetentionDays)

    ctx.logger('pig').info(`Cleaning up travel logs older than ${config.logRetentionDays} days (before ${cutoffDate.toISOString()})...`)

    try {
      const result = await ctx.database.remove('pig_travel_log', {
        timestamp: { $lt: cutoffDate }
      })
      ctx.logger('pig').info(`Cleaned up old travel logs`)
    } catch (e) {
      ctx.logger('pig').error('Failed to cleanup old travel logs:', e)
    }
  })
}
