import { Context } from 'koishi'
import '../types'
import { Config } from '../config'
import { Location, LOCATIONS } from '../constants'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { searchUnsplashPhoto } from './unsplash'
import { searchPexelsPhoto } from './pexels'

let llmCooldownUntil = 0

// 地点类别，用于增加多样性
const LOCATION_CATEGORIES = [
  '自然奇观（峡谷、瀑布、火山、冰川、沙漠绿洲等）',
  '历史遗迹（古城、废墟、考古遗址、古老寺庙等）',
  '现代建筑奇观（摩天大楼、桥梁、博物馆、体育场等）',
  '小众秘境（冷门国家的隐藏景点、当地人才知道的地方）',
  '极地与边境地区（南极科考站、北极圈小镇、国境线上的奇特地点）',
  '海岛与海滨（珊瑚礁、海崖、灯塔、渔村等）',
  '高山与高原（山峰、高原湖泊、山间村落、登山营地等）',
  '文化地标（宗教圣地、传统村落、民俗景点等）',
  '都市风情（特色街区、夜景地标、城市公园等）',
  '神秘与奇特之地（地质奇观、UFO小镇、怪异地貌等）'
]

// 大洲列表，用于地理分散
const CONTINENTS = ['亚洲', '欧洲', '非洲', '北美洲', '南美洲', '大洋洲', '南极洲']

interface SunriseTimezoneHint {
  utcOffsetRange: string
  regionHint: string
  beijingTime: string
  beijingHour: number
  idealOffset: number
  minOffset: number
  maxOffset: number
}

/**
 * 以东八区当前时间为基准，计算“此刻正处于日出时段（当地时间约 5:00-7:00）”的时区范围
 * 返回 UTC 偏移量范围，例如 "UTC+5 到 UTC+7"
 */
function getSunriseTimezoneHint(): SunriseTimezoneHint {
  const now = new Date()
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const beijingHour = beijingNow.getUTCHours()
  const beijingMinute = beijingNow.getUTCMinutes()

  // 日出中心时间按当地 06:00 估算，目标偏移 = 06:00 - 当前东八区小时 + 8
  const targetLocalHour = 6
  const idealOffset = targetLocalHour - beijingHour + 8

  // 标准化到 -12 到 +14 范围
  const normalizeOffset = (offset: number) => {
    if (offset < -12) return offset + 24
    if (offset > 14) return offset - 24
    return offset
  }

  const minOffset = normalizeOffset(idealOffset - 1)
  const maxOffset = normalizeOffset(idealOffset + 1)

  // 根据偏移量给出大致地区提示
  const getRegionByOffset = (offset: number): string => {
    if (offset >= 9 && offset <= 12) return '东亚、澳大利亚东部、太平洋岛屿'
    if (offset >= 5 && offset <= 8) return '南亚、东南亚、中亚'
    if (offset >= 2 && offset <= 4) return '中东、东欧、东非'
    if (offset >= -1 && offset <= 1) return '西欧、西非'
    if (offset >= -5 && offset <= -2) return '南美洲东部、大西洋'
    if (offset >= -8 && offset <= -6) return '北美洲西部、太平洋东部'
    if (offset >= -12 && offset <= -9) return '太平洋中部、夏威夷、阿拉斯加'
    return '全球各地'
  }

  const formatOffset = (offset: number) => offset >= 0 ? `UTC+${offset}` : `UTC${offset}`
  const beijingTime = `${String(beijingHour).padStart(2, '0')}:${String(beijingMinute).padStart(2, '0')}`

  return {
    utcOffsetRange: `${formatOffset(minOffset)} 到 ${formatOffset(maxOffset)}`,
    regionHint: getRegionByOffset(idealOffset),
    beijingTime,
    beijingHour,
    idealOffset,
    minOffset,
    maxOffset,
  }
}

function getRandomPromptHints(): { category: string; continent: string; avoidCountries: string; sunriseHint: SunriseTimezoneHint } {
  const category = LOCATION_CATEGORIES[Math.floor(Math.random() * LOCATION_CATEGORIES.length)]
  const continent = CONTINENTS[Math.floor(Math.random() * CONTINENTS.length)]

  // 随机选择一些要避免的热门国家，强制探索冷门地区
  const hotCountries = ['法国', '日本', '意大利', '美国', '英国', '中国', '西班牙', '泰国', '澳大利亚']
  const shuffled = hotCountries.sort(() => Math.random() - 0.5)
  const avoidCountries = shuffled.slice(0, 3 + Math.floor(Math.random() * 4)).join('、')

  // 获取当前日出时区提示
  const sunriseHint = getSunriseTimezoneHint()

  return { category, continent, avoidCountries, sunriseHint }
}

const LOCATION_GENERATION_PROMPT = `你是一位资深旅行探险家，专门发掘世界各地的独特目的地。

你的任务是生成一个真实存在的旅游目的地。要求：
1. 地点必须真实存在，可以是著名景点，也可以是小众秘境
2. 提供准确的地理信息
3. 尽量选择有趣、独特、不常见的地点
4. 避免总是选择最热门的旅游景点
5. landscapeUrl 请返回可访问的图片直链，优先使用 Pexels 或 Unsplash

请严格按照以下JSON格式输出（不要包含任何其他文字）：
{
  "country": "国家英文名",
  "countryZh": "国家中文名",
  "city": "城市/地区名",
  "landmark": "地标英文名",
  "landmarkZh": "地标中文名",
  "timezone": "IANA时区字符串",
  "landscapeUrl": "https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg 或 https://images.unsplash.com/..."
}`

/**
 * Generate a random location using LLM
 * Falls back to static LOCATIONS on any error
 */
export async function generateLocationWithLLM(
  ctx: Context,
  config: Config
): Promise<Location> {
  // Check if LLM is available
  if (!config.llmLocationEnabled || !config.llmLocationModel || !ctx.chatluna) {
    ctx.logger('pig').debug('LLM location generation not enabled or not available, using static locations')
    return getRandomStaticLocation()
  }

  const cooldownMs = config.llmFailureCooldownMs ?? 0
  if (cooldownMs > 0 && Date.now() < llmCooldownUntil) {
    if (config.debug) ctx.logger('pig').debug('LLM location generation in cooldown, using static locations')
    return getRandomStaticLocation()
  }

  try {
    ctx.logger('pig').info(`Using LLM to generate location with model: ${config.llmLocationModel}`)

    const modelRef = await ctx.chatluna.createChatModel(config.llmLocationModel)
    const model = modelRef.value

    if (!model) {
      ctx.logger('pig').warn(`Failed to create model: ${config.llmLocationModel}`)
      if (cooldownMs > 0) llmCooldownUntil = Date.now() + cooldownMs
      return getRandomStaticLocation()
    }

    // 生成随机提示增加多样性
    const hints = getRandomPromptHints()
    let userPrompt = `请生成一个【${hints.category}】类型的旅游目的地。

🌅 时区要求（重要）：当前东八区时间是 ${hints.sunriseHint.beijingTime}，请选择一个正处于日出时段（当地时间约 5:00-7:00）的地点。
符合条件的时区范围大约是 ${hints.sunriseHint.utcOffsetRange}，对应地区包括：${hints.sunriseHint.regionHint}。

如果上述地区没有合适的【${hints.category}】类型目的地，可以适当放宽到邻近时区，但优先选择正在迎接日出的地方。

特别要求：请避开 ${hints.avoidCountries} 这些热门国家，选择一个更独特、更少人知道的地方。要求这个地方在地理位置或文化上具有独特性。`

    if (config.llmLocationCustomContext) {
      userPrompt += `\n\n此外，请参考以下用户提供的偏好或上下文：${config.llmLocationCustomContext}`
    }

    userPrompt += `\n\n直接输出JSON，不要有任何其他文字。`

    if (config.debug) {
      ctx.logger('pig').debug(
        `Location prompt hints: bj=${hints.sunriseHint.beijingTime}, ` +
        `ideal=${hints.sunriseHint.idealOffset}, range=${hints.sunriseHint.utcOffsetRange}, ` +
        `region=${hints.sunriseHint.regionHint}, category=${hints.category}`
      )
    }

    const messages = [
      new SystemMessage(LOCATION_GENERATION_PROMPT),
      new HumanMessage(userPrompt)
    ]

    const response = await model.invoke(messages, { temperature: 1.0 })
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

    if (config.debug) ctx.logger('pig').debug(`LLM response: ${content}`)

    // Parse the JSON response
    const location = parseLocationResponse(content)

    if (location) {
      llmCooldownUntil = 0
      ctx.logger('pig').info(`LLM generated location: ${location.landmarkZh} (${location.landmark}), ${location.countryZh}`)

      // Try to get a real photo URL from APIs with multiple search attempts
      if (config.unsplashAccessKey || config.pexelsApiKey) {
        // Build search queries using user-defined template or defaults
        const template = config.imageSearchPrompt || '{landmark} {country} landscape'
        const formatQuery = (tmpl: string) => {
          const raw = tmpl
            .replace('{landmark}', location.landmark)
            .replace('{country}', location.country)
            .replace('{city}', location.city || '')
            .trim()
          // Remove non-Latin characters (Chinese, etc.) as Unsplash/Pexels search works poorly with them
          return raw.replace(/[^\u0000-\u007F\u00C0-\u024F\u1E00-\u1EFF]/g, ' ').replace(/\s+/g, ' ').trim()
        }

        // Helper to clean query (remove non-Latin characters)
        const cleanQuery = (q: string) => q.replace(/[^\u0000-\u007F\u00C0-\u024F\u1E00-\u1EFF]/g, ' ').replace(/\s+/g, ' ').trim()

        const searchQueries = [
          formatQuery(template),                                     // Primary: User template
          cleanQuery(`${location.landmark} ${location.country}`),    // Fallback 1: specific
          location.city ? cleanQuery(`${location.city} ${location.country}`) : null, // Fallback 2: city
          cleanQuery(location.country),                              // Fallback 3: country
        ].filter(Boolean) as string[]

        let photoUrl: string | null = null
        for (const query of searchQueries) {
          // 1. Try Pexels first (more stable network access)
          if (config.pexelsApiKey) {
            if (config.debug) ctx.logger('pig').debug(`Searching Pexels for: ${query}`)
            photoUrl = await searchPexelsPhoto(ctx, config.pexelsApiKey, query, config.debug)
          }

          // 2. Try Unsplash as fallback
          if (!photoUrl && config.unsplashAccessKey) {
            if (config.debug) ctx.logger('pig').debug(`Searching Unsplash for: ${query}`)
            photoUrl = await searchUnsplashPhoto(ctx, config.unsplashAccessKey, query, config.debug)
          }

          if (photoUrl) {
            ctx.logger('pig').info(`Found photo URL: ${photoUrl}`)
            location.landscapeUrl = photoUrl
            break
          }
        }

        if (!photoUrl && config.debug) {
          ctx.logger('pig').debug('All image searches returned no results, using LLM-generated URL fallback')
        }
      }

      return location
    }

    ctx.logger('pig').warn('Failed to parse LLM response, falling back to static locations')
    return getRandomStaticLocation()
  } catch (e) {
    ctx.logger('pig').error(`LLM location generation failed: ${e}`)
    if (cooldownMs > 0) llmCooldownUntil = Date.now() + cooldownMs
    return getRandomStaticLocation()
  }
}

/**
 * Parse the LLM response and extract Location data
 */
function parseLocationResponse(content: string): Location | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : content

    // Try to parse as JSON
    const data = JSON.parse(jsonStr.trim())

    // Validate required fields
    if (!data.country || !data.landmark || !data.landscapeUrl) {
      return null
    }

    // Construct the Location object with defaults
    const location: Location = {
      country: data.country,
      countryZh: data.countryZh || data.country,
      city: data.city || '',
      landmark: data.landmark,
      landmarkZh: data.landmarkZh || data.landmark,
      timezone: data.timezone || 'UTC',
      landscapeUrl: data.landscapeUrl
    }

    // Validate and fix landscapeUrl if needed
    if (!location.landscapeUrl.startsWith('http')) {
      // Create a sensible fallback URL using the search keywords
      const query = `${encodeURIComponent(location.landmark)},${encodeURIComponent(location.country)}`
      location.landscapeUrl = `https://images.unsplash.com/featured/?${query}`
    }

    return location
  } catch (e) {
    // Try a more lenient extraction
    try {
      // Look for JSON-like object in the content
      const objectMatch = content.match(/\{[\s\S]*"country"[\s\S]*"landmark"[\s\S]*\}/)
      if (objectMatch) {
        return parseLocationResponse(objectMatch[0])
      }
    } catch {
      // Ignore nested errors
    }
    return null
  }
}

/**
 * Get a random location from the static LOCATIONS array
 */
export function getRandomStaticLocation(): Location {
  return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)]
}
