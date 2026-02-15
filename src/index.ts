import { Context, segment, h } from 'koishi'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import {} from 'koishi-plugin-cron'
import {} from 'koishi-plugin-glyph'
import './types'
import { Config } from './config'
import { applyDatabase } from './database'
import { getSunriseInfo } from './services/sunrise'
import { triggerTravelSequence, TravelResult, UserInfo } from './services/travel'
import { prepareMonthlySummary, generateMonthlySummaryCard, getUsersWithLogsInMonth, prepareMonthlySummaryGroup, generateMonthlySummaryGroupCard } from './services/summary'
import { getPigLeaderboard, getSleepLeaderboard, generatePigLeaderboardCard, generateSleepLeaderboardCard } from './services/leaderboard'
import { prepareWorldMapData, prepareGuildWorldMapData, generateWorldMapCard } from './services/worldmap'
import { getAdminBackgroundImage, setGuildBackgroundImage, getGuildBackgroundInfo } from './services/background'
import { ensurePigSvgAssets, setPigSvgDir } from './services/pig-icon'

export const name = 'my-pig-group-friends'
export const inject = {
  required: ['database', 'cron', 'puppeteer'],
  optional: ['mediaLuna', 'chatluna_storage', 'chatluna', 'glyph']
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
    return `${segment.at(userId)} ${result.msg}\n${segment.image(`data:image/png;base64,${base64}`)}`
  }

  // 无图片时只发文本
  return `${segment.at(userId)} ${result.msg}`
}

export function apply(ctx: Context, config: Config) {
  ctx.logger('pig').info('my-pig-group-friends plugin is loading...')
  applyDatabase(ctx)
  const dataRoot = resolve(ctx.baseDir ?? process.cwd(), 'data', 'pig', 'svgs')
  const cwdRoot = resolve(process.cwd(), 'data', 'pig', 'svgs')
  const parentRoot = resolve(process.cwd(), '..', 'data', 'pig', 'svgs')
  const parent2Root = resolve(process.cwd(), '..', '..', 'data', 'pig', 'svgs')
  const svgDirCandidates = [dataRoot, cwdRoot, parentRoot, parent2Root]
  const detectSvgDir = async () => {
    for (const dir of svgDirCandidates) {
      try {
        const entries = await fs.readdir(dir)
        if (entries.some(name => name.toLowerCase().endsWith('.svg'))) {
          setPigSvgDir(dir)
          ctx.logger('pig').info(`Pig SVG dir detected: ${dir}`)
          return
        }
      } catch {
        // ignore missing dir
      }
    }
    setPigSvgDir(dataRoot)
    await ensurePigSvgAssets(dataRoot)
    ctx.logger('pig').info(`Pig SVG dir prepared: ${dataRoot}`)
  }
  detectSvgDir().catch((e) => ctx.logger('pig').warn(`Failed to prepare pig svg assets: ${e}`))

  // 检查存储服务状态
  if (config.useStorageService && !ctx.chatluna_storage) {
    ctx.logger('pig').warn('useStorageService 已启用但 chatluna_storage 服务不可用，将回退到 base64 模式')
  }

  // 用于防止重复触发的锁（用户ID -> 锁定时间戳）
  const travelLocks = new Map<string, number>()
  const LOCK_DURATION_MS = 60 * 1000 // 60秒锁定期

  // 用户每日状态缓存 (key: `${platform}:${userId}`)
  const dailyUserState = new Map<string, {
    recordedToday: boolean
    cardSentToday: boolean
    lastSunrise: Date | null
  }>()

  // 获取今日日出时间（带缓存）
  let cachedSunriseDate: string | null = null
  let cachedSunrise: Date | null = null
  const getTodaySunrise = async (): Promise<Date> => {
    const today = new Date().toDateString()
    if (cachedSunriseDate === today && cachedSunrise) return cachedSunrise
    const info = await getSunriseInfo(ctx, config.defaultLat, config.defaultLng)
    cachedSunrise = info.sunrise
    cachedSunriseDate = today
    return cachedSunrise
  }

  const resolveUserArg = (argv: any, user?: string) => {
    if (!user) return null
    if (user.includes(':') && !user.startsWith('<')) return user
    const parsed = ctx.$commander.parseValue(user, 'argument', argv, { name: 'user', type: 'user' }) as string | undefined
    if (!parsed) return null
    return parsed
  }

  ctx.command('pig', '虚拟旅行', { checkArgCount: false })
    .alias('猪醒', 'pig.travel')
    .usage('猪醒 [@用户]')
    .example('猪醒')
    .example('猪醒 @某人')
    .action(async (argv, user) => {
      const { session } = argv
      // 如果没有指定用户，默认使用发送者自己
      let platform: string
      let userId: string
      if (user) {
        const parsed = resolveUserArg(argv, user)
        if (!parsed) return argv.error ?? '参数 user 输入无效，请指定正确的用户。'
        ;[platform, userId] = parsed.split(':')
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

      const result = await triggerTravelSequence(ctx, config, userInfo, platform, session.guildId || '')
      return formatTravelMessage(result, userId, config)
    })

  // 月度总结调试命令
  ctx.command('pig.summary [year:number] [month:number] [user:user]', '生成月度旅行总结')
    .option('all', '-a 生成所有用户的总结')
    .action(async ({ session, options }, yearArg, monthArg, targetUser) => {
      const now = new Date()
      // 默认为上个月
      let year = yearArg ?? now.getFullYear()
      let month = monthArg ?? now.getMonth() // getMonth() 是 0-based，不加1就是上个月

      // 如果当前是1月且没有指定年份，需要回到去年12月
      if (!monthArg && now.getMonth() === 0) {
        year = now.getFullYear() - 1
        month = 12
      } else if (!monthArg) {
        month = now.getMonth() // 上个月
      }

      // 验证月份范围
      if (month < 1 || month > 12) {
        return '月份必须在 1-12 之间'
      }

      // 确定目标用户
      let targetPlatform = session.platform
      let targetUserId = session.userId

      if (targetUser) {
        // 解析 @用户 参数
        const [platform, userId] = targetUser.split(':')
        if (userId) {
          targetPlatform = platform
          targetUserId = userId
        } else {
          // 如果没有 platform: 前缀，直接使用当前 platform
          targetUserId = platform
        }
      }

      await session.send(`正在生成 ${year}年${month}月 的旅行总结...`)

      try {
        if (options.all) {
          if (config.monthlySummaryScope === 'guild' && !session.guildId) {
            return '当前模式为按群统计，请在群组内使用该命令'
          }
          // 生成所有用户的总结
          const users = await getUsersWithLogsInMonth(
            ctx,
            year,
            month,
            config.monthlySummaryScope === 'guild' ? session.guildId : undefined
          )

          if (users.length === 0) {
            return `${year}年${month}月 没有任何旅行记录`
          }

          const profiles = new Map<string, { username?: string; avatarUrl?: string }>()
          for (const { userId, platform } of users) {
            let username = userId
            let avatarUrl = ''
            const isNumericId = /^\d+$/.test(userId)

            const isQQ = platform === 'onebot' || platform === 'qq' || platform.includes('qq')
            if (isQQ && isNumericId) {
              avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`
            }

            if (session.bot && platform === session.platform && isNumericId) {
              if (session.guildId && session.bot.getGuildMember) {
                try {
                  const member = await session.bot.getGuildMember(session.guildId, userId)
                  username = member.nick || member.name || member.user?.name || username
                  avatarUrl = avatarUrl || member.user?.avatar || ''
                } catch {
                  // ignore member fetch error
                }
              }

              if (username === userId && session.bot.getUser) {
                try {
                  const user = await session.bot.getUser(userId)
                  username = user.name || username
                  avatarUrl = avatarUrl || user.avatar || ''
                } catch {
                  // ignore user fetch error
                }
              }
            }

            profiles.set(`${platform}:${userId}`, { username, avatarUrl })
          }

          const summaryGroupData = await prepareMonthlySummaryGroup(
            ctx,
            year,
            month,
            config.monthlySummaryScope === 'guild' ? session.guildId : undefined,
            profiles
          )

          if (config.monthlySummaryScope === 'guild' && session.guildId) {
            const adminBackgroundImage = await getAdminBackgroundImage(ctx, session.platform, session.guildId)
            if (adminBackgroundImage) {
              summaryGroupData.backgroundImage = adminBackgroundImage
            }
          }

          const result = await generateMonthlySummaryGroupCard(ctx, config, summaryGroupData)
          const base64 = result.buffer.toString('base64')
          return `${year}年${month}月 旅行大合照\n${segment.image(`data:image/png;base64,${base64}`)}`
        } else {
          // 生成指定用户的总结
          let avatarUrl = ''
          let username = targetUserId

          // 如果是自己，使用 session 中的信息
          if (targetUserId === session.userId) {
            avatarUrl = session.author?.avatar || ''
            username = session.author?.nickname || session.author?.name || session.username || targetUserId
          }

          const isNumericTargetId = /^\d+$/.test(targetUserId)

          // 处理 QQ 头像 - onebot 或 qq 平台
          if (!avatarUrl && isNumericTargetId && (targetPlatform === 'onebot' || targetPlatform === 'qq' || targetPlatform.includes('qq'))) {
            avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${targetUserId}&spec=640`
          }

          // 尝试获取目标用户的群成员信息
          if (isNumericTargetId && targetUserId !== session.userId && session.bot?.getGuildMember && session.guildId) {
            try {
              const member = await session.bot.getGuildMember(session.guildId, targetUserId)
              username = member.nick || member.name || member.user?.name || username
              if (!avatarUrl) {
                avatarUrl = member.user?.avatar || ''
              }
            } catch (e) {
              // 忽略获取失败
              if (config.debug) {
                ctx.logger('pig').debug(`Failed to get guild member info: ${e}`)
              }
            }
          }

          const userInfo: UserInfo = {
            userId: targetUserId,
            username,
            avatarUrl
          }

          const summaryData = await prepareMonthlySummary(
            ctx,
            targetUserId,
            targetPlatform,
            userInfo.username,
            userInfo.avatarUrl,
            year,
            month,
            config.monthlySummaryScope === 'guild' ? session.guildId : undefined
          )

          const result = await generateMonthlySummaryCard(ctx, config, summaryData)

          // 发送卡片
          const base64 = result.buffer.toString('base64')
          return `${segment.at(targetUserId)} ${year}年${month}月 旅行总结\n${segment.image(`data:image/png;base64,${base64}`)}`
        }
      } catch (e) {
        ctx.logger('pig').error('Failed to generate monthly summary:', e)
        return `生成月度总结失败: ${e}`
      }
    })

  // 猪排行榜
  ctx.command('pig.rank', '查看群内猪排行榜')
    .alias('猪排行')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return '请在群组中使用此命令'
      }

      try {
        await session.send('正在生成猪排行榜...')

        // 获取排行数据
        const entries = await getPigLeaderboard(ctx, session.guildId, session.platform, 10)

        if (entries.length === 0) {
          return '本群还没有旅行记录哦~'
        }

        // 获取群组统一背景
        const backgroundImage = await getAdminBackgroundImage(ctx, session.platform, session.guildId)

        // 填充用户信息（昵称和头像）
        for (const entry of entries) {
          try {
            // QQ 平台头像
            if (session.platform === 'onebot' || session.platform === 'qq' || session.platform.includes('qq')) {
              entry.avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${entry.userId}&spec=640`
            }

            // 尝试获取群成员信息
            if (session.bot?.getGuildMember) {
              try {
                const member = await session.bot.getGuildMember(session.guildId, entry.userId)
                entry.username = member.nick || member.name || member.user?.name || entry.userId
                if (!entry.avatarUrl) {
                  entry.avatarUrl = member.user?.avatar || ''
                }
              } catch {
                // 忽略获取失败
              }
            }
          } catch {
            // 忽略用户信息获取失败
          }
        }

        // 生成卡片
        const result = await generatePigLeaderboardCard(ctx, config, entries, session.guildId, backgroundImage)

        // 返回图片
        const base64 = result.buffer.toString('base64')
        return segment.image(`data:image/png;base64,${base64}`)
      } catch (e) {
        ctx.logger('pig').error('Failed to generate pig leaderboard:', e)
        return `生成猪排行榜失败: ${e}`
      }
    })

  // 作息排行榜
  ctx.command('pig.sleep', '查看群内作息排行榜')
    .alias('熬夜榜')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return '请在群组中使用此命令'
      }

      try {
        await session.send('正在生成熬夜王榜...')

        // 获取排行数据
        const entries = await getSleepLeaderboard(ctx, session.guildId, session.platform, 10)

        if (entries.length === 0) {
          return '本群还没有熬夜记录哦~'
        }

        // 获取群组统一背景
        const backgroundImage = await getAdminBackgroundImage(ctx, session.platform, session.guildId)

        // 填充用户信息（昵称和头像）
        for (const entry of entries) {
          try {
            // QQ 平台头像
            if (session.platform === 'onebot' || session.platform === 'qq' || session.platform.includes('qq')) {
              entry.avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${entry.userId}&spec=640`
            }

            // 尝试获取群成员信息
            if (session.bot?.getGuildMember) {
              try {
                const member = await session.bot.getGuildMember(session.guildId, entry.userId)
                entry.username = member.nick || member.name || member.user?.name || entry.userId
                if (!entry.avatarUrl) {
                  entry.avatarUrl = member.user?.avatar || ''
                }
              } catch {
                // 忽略获取失败
              }
            }
          } catch {
            // 忽略用户信息获取失败
          }
        }

        // 生成卡片
        const result = await generateSleepLeaderboardCard(ctx, config, entries, session.guildId, backgroundImage)

        // 返回图片
        const base64 = result.buffer.toString('base64')
        return segment.image(`data:image/png;base64,${base64}`)
      } catch (e) {
        ctx.logger('pig').error('Failed to generate sleep leaderboard:', e)
        return `生成熬夜王榜失败: ${e}`
      }
    })

  // 世界足迹地图
  ctx.command('pig.map [user:user]', '查看用户的世界足迹地图')
    .alias('世界足迹')
    .option('all', '-a 显示本群全部成员的足迹')
    .action(async ({ session, options }, user) => {
      const platform = session.platform
      const guildId = session.guildId

      // -a 选项：显示本群全部成员的足迹
      if (options.all) {
        if (!guildId) {
          return '该命令需要在群组中使用'
        }

        await session.send('正在生成群组世界足迹地图...')

        try {
          // 获取群组名称和头像
          let guildName = '本群足迹'
          let guildAvatarUrl = ''
          if (session.bot?.getGuild) {
            try {
              const guild = await session.bot.getGuild(guildId)
              guildName = guild.name || guildName
              guildAvatarUrl = guild.avatar || ''
            } catch {
              // ignore
            }
          }
          // OneBot 平台使用 QQ 群头像 API
          if (!guildAvatarUrl && (platform === 'onebot' || platform === 'qq' || platform.includes('qq'))) {
            guildAvatarUrl = `https://p.qlogo.cn/gh/${guildId}/${guildId}/640`
          }

          const data = await prepareGuildWorldMapData(
            ctx,
            guildId,
            platform,
            guildName,
            guildAvatarUrl
          )

          if (data.totalTrips === 0) {
            return '本群还没有旅行记录'
          }

          const result = await generateWorldMapCard(ctx, config, data)
          const base64 = result.buffer.toString('base64')
          return segment.image(`data:image/png;base64,${base64}`)
        } catch (e) {
          ctx.logger('pig').error('Failed to generate guild world map card:', e)
          return `生成群组世界足迹地图失败: ${e}`
        }
      }

      // 个人足迹模式
      let userId: string
      let userPlatform: string
      if (user) {
        [userPlatform, userId] = user.split(':')
      } else {
        userPlatform = platform
        userId = session.userId
      }

      let username = userId
      let avatarUrl = ''

      try {
        if (session?.userId === userId) {
          username = session.author?.nickname || session.author?.name || session.username || userId
          avatarUrl = session.author?.avatar || ''
        } else {
          if (userPlatform === 'onebot' || userPlatform === 'qq' || userPlatform.includes('qq')) {
            avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${userId}&spec=640`
          }

          if (session.bot?.getGuildMember && guildId) {
            try {
              const member = await session.bot.getGuildMember(guildId, userId)
              username = member.nick || member.name || member.user?.name || username
              avatarUrl = avatarUrl || member.user?.avatar || ''
            } catch {
              // ignore
            }
          }

          if (username === userId && session.bot?.getUser) {
            try {
              const userInfo = await session.bot.getUser(userId)
              username = userInfo.name || username
              avatarUrl = avatarUrl || userInfo.avatar || ''
            } catch {
              // ignore
            }
          }
        }
      } catch (e) {
        ctx.logger('pig').warn(`Failed to fetch metadata for user ${userId}: ${e}`)
      }

      await session.send('正在生成世界足迹地图...')

      try {
        const data = await prepareWorldMapData(
          ctx,
          userId,
          userPlatform,
          username,
          avatarUrl,
          guildId || undefined
        )

        if (data.totalTrips === 0) {
          return '还没有旅行记录'
        }

        const result = await generateWorldMapCard(ctx, config, data)
        const base64 = result.buffer.toString('base64')
        return segment.image(`data:image/png;base64,${base64}`)
      } catch (e) {
        ctx.logger('pig').error('Failed to generate world map card:', e)
        return `生成世界足迹地图失败: ${e}`
      }
    })

  // 群组背景图片设置（仅管理员可用）
  ctx.command('pig.bg', '设置/查看群组背景图片（仅管理员可用）')
    .option('reset', '-r 重置为默认背景')
    .action(async ({ session, options }) => {
      const platform = session.platform
      const userId = session.userId
      const guildId = session.guildId

      // 必须在群组中使用
      if (!guildId) {
        return '请在群组中使用此命令'
      }

      // 检查用户权限
      // 1. Koishi authority >= 3 的用户
      // 2. 群主 (owner) 或群管理员 (admin)
      const user = await ctx.database.getUser(platform, userId, ['authority'])
      const authority = user?.authority ?? 0
      // 从多个可能的位置获取用户角色（不同适配器存放位置不同）
      const memberRole = session.author?.roles?.[0]
        || (session.event as any)?.member?.roles?.[0]
        || (session.event as any)?.member?.role
        || (session as any).onebot?.sender?.role
      const isGuildAdmin = memberRole === 'owner' || memberRole === 'admin'

      if (config.debug) {
        ctx.logger('pig').debug(`pig.bg permission check: userId=${userId}, authority=${authority}, memberRole=${memberRole}, isGuildAdmin=${isGuildAdmin}`)
      }

      if (authority < 3 && !isGuildAdmin) {
        // 普通用户只能查看当前背景
        const bgInfo = await getGuildBackgroundInfo(ctx, platform, guildId)
        if (bgInfo?.backgroundImage) {
          const bgPath = bgInfo.backgroundImage.startsWith('file://')
            ? '(本地文件)'
            : bgInfo.backgroundImage
          const setAt = bgInfo.setAt ? new Date(bgInfo.setAt).toLocaleDateString('zh-CN') : '未知'
          return `当前群组背景: ${bgPath}\n设置时间: ${setAt}\n\n(仅管理员可修改群组背景)`
        }
        return '当前群组使用默认背景\n\n(仅管理员可设置群组背景)'
      }

      // 管理员操作

      // 重置背景
      if (options.reset) {
        const bgInfo = await getGuildBackgroundInfo(ctx, platform, guildId)
        if (bgInfo?.backgroundImage) {
          // 如果是本地文件，尝试删除
          if (bgInfo.backgroundImage.startsWith('file://')) {
            try {
              const filePath = bgInfo.backgroundImage.replace('file://', '')
              await fs.unlink(filePath)
              ctx.logger('pig').info(`Deleted guild background file: ${filePath}`)
            } catch (e) {
              ctx.logger('pig').warn(`Failed to delete guild background file: ${e}`)
            }
          }
          await setGuildBackgroundImage(ctx, platform, guildId, null, userId)
        }
        return '已重置群组背景为默认'
      }

      // 解析消息中的图片
      const elements = h.parse(session.content || '')
      const imgElement = elements.find(el => el.type === 'img' || el.type === 'image')

      let imageUrl: string | undefined

      if (imgElement) {
        // 从图片元素获取 URL
        imageUrl = imgElement.attrs?.src || imgElement.attrs?.url
      } else {
        // 尝试从文本中提取 URL
        const textContent = elements
          .filter(el => el.type === 'text')
          .map(el => el.attrs?.content || '')
          .join('')
          .trim()

        if (textContent && (textContent.startsWith('http://') || textContent.startsWith('https://'))) {
          imageUrl = textContent
        }
      }

      // 查看当前背景
      if (!imageUrl) {
        const bgInfo = await getGuildBackgroundInfo(ctx, platform, guildId)
        if (bgInfo?.backgroundImage) {
          const bgPath = bgInfo.backgroundImage.startsWith('file://')
            ? '(本地文件)'
            : bgInfo.backgroundImage
          const setAt = bgInfo.setAt ? new Date(bgInfo.setAt).toLocaleDateString('zh-CN') : '未知'
          return `当前群组背景: ${bgPath}\n设置时间: ${setAt}\n\n发送 "pig.bg" + 图片 设置新背景\n发送 "pig.bg -r" 重置为默认`
        }
        return '当前群组使用默认背景\n\n发送 "pig.bg" + 图片 设置群组背景\n或发送 "pig.bg <URL>" 使用网络图片'
      }

      await session.send('正在处理图片...')

      try {
        // 确保存储目录存在
        const storagePath = resolve(config.backgroundStoragePath)
        await fs.mkdir(storagePath, { recursive: true })

        // 下载图片
        const response = await ctx.http(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })

        const buffer = Buffer.from(response.data as ArrayBuffer)

        // 验证是否为图片
        const contentType = response.headers?.['content-type'] || ''
        if (contentType && !contentType.includes('image')) {
          return `下载的内容不是图片（Content-Type: ${contentType}）`
        }

        // 根据 Content-Type 确定扩展名
        let ext = '.png'
        if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg'
        else if (contentType.includes('gif')) ext = '.gif'
        else if (contentType.includes('webp')) ext = '.webp'

        // 生成文件名（群组背景使用 guild 前缀）
        const filename = `guild_bg_${platform}_${guildId}_${Date.now()}${ext}`
        const filePath = join(storagePath, filename)

        // 删除旧的本地背景文件（如果有）
        const oldBgInfo = await getGuildBackgroundInfo(ctx, platform, guildId)
        if (oldBgInfo?.backgroundImage?.startsWith('file://')) {
          try {
            const oldPath = oldBgInfo.backgroundImage.replace('file://', '')
            await fs.unlink(oldPath)
            ctx.logger('pig').info(`Deleted old guild background: ${oldPath}`)
          } catch (e) {
            // 忽略删除失败
          }
        }

        // 保存文件
        await fs.writeFile(filePath, buffer)
        ctx.logger('pig').info(`Guild background saved: ${filePath}`)

        // 保存到群组配置表
        await setGuildBackgroundImage(ctx, platform, guildId, `file://${filePath}`, userId)

        return `群组背景图片已设置！\n\n新背景将在下次生成 Summary 或排行榜时生效。`
      } catch (e) {
        ctx.logger('pig').error(`Failed to save guild background: ${e}`)
        return `保存群组背景图片失败: ${e}`
      }
    }) 

  // 后台静默记录：日出后首条消息
  ctx.middleware(async (session, next) => {
    if (!config.silentRecordEnabled) return next()
    if (!session.userId || !session.guildId) return next()

    const userKey = `${session.platform}:${session.userId}`
    const state = dailyUserState.get(userKey)
    if (state?.recordedToday) return next()

    let sunrise: Date
    try {
      sunrise = await getTodaySunrise()
    } catch (e) {
      ctx.logger('pig').warn(`Failed to fetch sunrise info: ${e}`)
      return next()
    }

    const now = new Date()
    if (now < sunrise) return next()

    try {
      await ctx.database.upsert('pig_user_state', [{
        platform: session.platform,
        userId: session.userId,
        guildId: session.guildId || '',
        lastWakeUp: now,
        lastSunrise: sunrise,
      }], ['platform', 'userId', 'guildId'])
    } catch (e) {
      ctx.logger('pig').warn(`Failed to record wake-up time for ${session.userId}: ${e}`)
      return next()
    }

    dailyUserState.set(userKey, {
      recordedToday: true,
      cardSentToday: state?.cardSentToday ?? false,
      lastSunrise: sunrise,
    })

    if (config.silentRecordAutoTravel && !state?.cardSentToday) {
      const latestState = dailyUserState.get(userKey)
      if (latestState) latestState.cardSentToday = true

      const userInfo: UserInfo = {
        userId: session.userId,
        username: session.author?.nickname || session.author?.name || session.username || session.userId,
        avatarUrl: session.author?.avatar || ''
      }

      void triggerTravelSequence(ctx, config, userInfo, session.platform, session.guildId || '')
        .then(result => session.send(formatTravelMessage(result, session.userId, config)))
        .catch(err => ctx.logger('pig').warn(`Failed to auto travel for ${session.userId}: ${err}`))
    }

    return next()
  }, true)

  ctx.middleware(async (session, next) => {
    // 如果没有开启实验性自动检测功能，直接跳过
    if (!config.experimentalAutoDetect) return next()
    if (config.experimentalAutoDetectScope !== 'all' && !session.guildId) return next()

    const hasContent = !!session.content
    const hasElements = Array.isArray(session.elements) && session.elements.length > 0
    if (!session.userId || (!hasContent && !hasElements)) return next()

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
      guildId: session.guildId || '',
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
          guildId: session.guildId || '',
          lastWakeUp: nowDate,
          lastSunrise: sunriseInfo.sunrise,
          abnormalCount: userState?.abnormalCount ?? 0,
        }], ['platform', 'userId', 'guildId'])

        // This is the first message of the day
        if (userState?.lastWakeUp) {
          const diffHours = Math.abs((nowDate.getTime() - userState.lastWakeUp.getTime() - 24 * 60 * 60 * 1000) / (1000 * 60 * 60))

          if (diffHours > config.abnormalThreshold) {
            // 设置锁定，防止重复触发
            travelLocks.set(lockKey, now)

            // 递增作息异常次数
            await ctx.database.upsert('pig_user_state', [{
              userId: session.userId,
              platform: session.platform,
              guildId: session.guildId || '',
              abnormalCount: (userState?.abnormalCount ?? 0) + 1,
            }], ['platform', 'userId', 'guildId'])

            // Trigger Travel Sequence
            await session.send(`检测到 ${segment.at(session.userId)} 作息异常（差异: ${diffHours.toFixed(1)}小时），准备虚拟旅行...`)

            const userInfo: UserInfo = {
              userId: session.userId,
              username: session.author?.nickname || session.author?.name || session.username || session.userId,
              avatarUrl: session.author?.avatar || ''
            }

            const result = await triggerTravelSequence(ctx, config, userInfo, session.platform, session.guildId || '')
            await session.send(formatTravelMessage(result, session.userId, config))
          }
        }
      }
    } catch (e) {
      ctx.logger('pig').error('Failed to process wake-up detection:', e)
    }

    return next()
  })

  // 消息统计 + 熬夜检测中间件
  ctx.middleware(async (session, next) => {
    const hasContent = !!session.content
    const hasElements = Array.isArray(session.elements) && session.elements.length > 0
    if (!session.userId || (!hasContent && !hasElements)) return next()

    const now = new Date()
    const currentHour = now.getHours()

    // 获取用户状态
    const [userState] = await ctx.database.get('pig_user_state', {
      userId: session.userId,
      platform: session.platform,
      guildId: session.guildId || '',
    })

    // 解析现有的小时消息统计
    let hourlyCounts: Record<string, number> = {}
    try {
      hourlyCounts = userState?.hourlyMessageCounts ? JSON.parse(userState.hourlyMessageCounts) : {}
    } catch {
      hourlyCounts = {}
    }

    // 更新当前小时的消息数
    const hourKey = currentHour.toString()
    hourlyCounts[hourKey] = (hourlyCounts[hourKey] || 0) + 1

    // 检查是否在熬夜时段
    const startHour = config.nightOwlStartHour ?? 0
    const endHour = config.nightOwlEndHour ?? 5

    let isNightOwlTime = false
    if (startHour <= endHour) {
      isNightOwlTime = currentHour >= startHour && currentHour < endHour
    } else {
      isNightOwlTime = currentHour >= startHour || currentHour < endHour
    }

    // 准备更新数据
    const updateData: any = {
      userId: session.userId,
      platform: session.platform,
      guildId: session.guildId || '',
      totalMessageCount: (userState?.totalMessageCount ?? 0) + 1,
      nightMessageCount: (userState?.nightMessageCount ?? 0) + (isNightOwlTime ? 1 : 0),
      hourlyMessageCounts: JSON.stringify(hourlyCounts),
    }

    // 如果开启熬夜检测且在熬夜时段
    if (config.nightOwlEnabled && isNightOwlTime) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const lastNightOwlDate = userState?.lastNightOwlDate

      let alreadyRecordedToday = false
      if (lastNightOwlDate) {
        const lastDate = new Date(lastNightOwlDate)
        const lastDateOnly = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate())
        alreadyRecordedToday = lastDateOnly.getTime() === today.getTime()
      }

      if (!alreadyRecordedToday) {
        updateData.nightOwlCount = (userState?.nightOwlCount ?? 0) + 1
        updateData.lastNightOwlDate = now

        if (config.debug) {
          ctx.logger('pig').info(`用户 ${session.userId} 熬夜 +1，当前累计: ${updateData.nightOwlCount} 次`)
        }
      }
    }

    await ctx.database.upsert('pig_user_state', [updateData], ['platform', 'userId', 'guildId'])

    return next()
  })

  // 每日重置静默记录状态
  ctx.cron('1 0 * * *', () => {
    dailyUserState.clear()
    cachedSunrise = null
    cachedSunriseDate = null
    ctx.logger('pig').info('Daily user state cache cleared')
  })

  // Monthly Travel Handbook - 每月1日凌晨生成上月总结
  if (config.monthlySummaryEnabled) {
    // 使用每日检查避免跨月间隔超出 setTimeout 上限
    ctx.cron('5 0 * * *', async () => {
      const now = new Date()
      if (now.getDate() !== 1) return
      if (config.monthlySummaryScope === 'guild') {
        ctx.logger('pig').warn('Monthly summary scope is guild, but cron has no guild context. Skipping...')
        return
      }

      // 计算上个月
      let year = now.getFullYear()
      let month = now.getMonth() // getMonth() 是 0-based，这里刚好是上个月
      if (month === 0) {
        year -= 1
        month = 12
      }

      ctx.logger('pig').info(`Generating monthly travel handbook for ${year}/${month}...`)

      try {
        const users = await getUsersWithLogsInMonth(ctx, year, month)

        if (users.length === 0) {
          ctx.logger('pig').info(`No travel logs found for ${year}/${month}`)
          return
        }

        ctx.logger('pig').info(`Found ${users.length} users with travel logs for ${year}/${month}`)

        for (const { userId, platform } of users) {
          try {
            const summaryData = await prepareMonthlySummary(
              ctx,
              userId,
              platform,
              userId,
              '',
              year,
              month
            )
            await generateMonthlySummaryCard(ctx, config, summaryData)
            ctx.logger('pig').info(`Generated summary for user ${userId}`)

            // TODO: 发送到对应群组（需要记录用户所在群组的机制）
          } catch (e) {
            ctx.logger('pig').error(`Failed to generate summary for user ${userId}:`, e)
          }
        }

        ctx.logger('pig').info(`Monthly handbook generation completed for ${year}/${month}`)
      } catch (e) {
        ctx.logger('pig').error('Failed to generate monthly travel handbook:', e)
      }
    })
  } else if (config.debug) {
    ctx.logger('pig').debug('Monthly summary is disabled, cron not registered.')
  }

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
