import { Context } from 'koishi'
import '../types'
import { Config } from '../config'
import { LOCATIONS, Location } from '../constants'
import { generateFootprintCard, CardData } from './card'
import { generateLocationWithLLM, getRandomStaticLocation } from './location'

export interface TravelResult {
  location: Location
  imageBuffer: Buffer | null
  imageUrl: string | null
  isAIGC: boolean
  msg: string
}

export interface UserInfo {
  userId: string
  username: string
  avatarUrl: string
}

export async function triggerTravelSequence(ctx: Context, config: Config, userInfo: UserInfo, platform: string, guildId: string = ''): Promise<TravelResult> {
  // Get location - use LLM if enabled, otherwise use static locations
  let location: Location
  if (config.llmLocationEnabled && ctx.chatluna) {
    location = await generateLocationWithLLM(ctx, config)
  } else {
    location = getRandomStaticLocation()
  }

  let imageBuffer: Buffer | null = null
  let imageUrl: string | null = null
  let isAIGC = false

  // 使用中文模板
  const msg = config.travelMessageTemplate
      .replace('{landmark}', location.landmarkZh || location.landmark)
      .replace('{country}', location.countryZh || location.country)

  // 只有在图片模式下才处理图片
  if (config.outputMode === 'image') {
    let backgroundUrl: string | null = null

    // 尝试使用 AIGC 生成背景
    if (config.aigcEnabled && config.aigcChannel && ctx.mediaLuna) {
      isAIGC = true
      ctx.logger('pig').info(`使用 media-luna 生成 AIGC 图片: ${userInfo.userId} @ ${location.landmark}`)

      const prompt = config.aigcPrompt
        .replace('{landmark}', location.landmark)
        .replace('{country}', location.country)

      try {
        const result = await ctx.mediaLuna.generateByName({
          channelName: config.aigcChannel,
          prompt,
          session: null,
        })

        if (result.success && result.output && result.output.length > 0) {
          const output = result.output[0]
          if (output.url) {
            backgroundUrl = output.url
            ctx.logger('pig').info(`AIGC 背景图已生成: ${backgroundUrl}`)
          }
        } else {
          ctx.logger('pig').warn(`AIGC 生成失败: ${result.error}`)
          isAIGC = false
        }
      } catch (e) {
        ctx.logger('pig').error(`AIGC 调用失败: ${e}`)
        isAIGC = false
      }
    }

    // AIGC 失败或未启用时，使用预设风景图
    if (!backgroundUrl) {
      backgroundUrl = location.landscapeUrl
      ctx.logger('pig').info(`使用预设风景图: ${location.landmark} (${backgroundUrl})`)
    }

    if (config.debug) {
      ctx.logger('pig').debug(`最终确定的背景图 URL: ${backgroundUrl}`)
    }

    // 生成卡片
    try {
      const cardData: CardData = { location, msg }
      const cardResult = await generateFootprintCard(ctx, config, cardData, userInfo, platform, backgroundUrl)
      imageBuffer = cardResult.buffer

      // 如果启用了存储服务，上传到存储服务获取 URL
      if (config.useStorageService && ctx.chatluna_storage) {
        try {
          const fileInfo = await ctx.chatluna_storage.createTempFile(
            cardResult.buffer,
            cardResult.filename,
            config.storageCacheHours
          )
          imageUrl = fileInfo.url
          ctx.logger('pig').info(`卡片已上传到存储服务: ${imageUrl}`)
        } catch (e) {
          ctx.logger('pig').warn(`上传到存储服务失败: ${e}`)
          // imageBuffer 仍然可用，会回退到 base64
        }
      }
    } catch (e) {
      ctx.logger('pig').error(`生成足迹卡片失败: ${e}`)
    }
  }

  // 记录到数据库
  const now = new Date()
  await ctx.database.create('pig_travel_log', {
    userId: userInfo.userId,
    platform,
    guildId,
    timestamp: now,
    country: location.country,
    countryZh: location.countryZh || location.country,
    location: location.landmark,
    locationZh: location.landmarkZh || location.landmark,
    timezone: location.timezone || 'UTC',
    imagePath: imageUrl || '', // 存储 URL 或空
    isAIGC,
  })

  return {
    location,
    imageBuffer,
    imageUrl,
    isAIGC,
    msg
  }
}
