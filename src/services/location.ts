import { Context } from 'koishi'
import '../types'
import { Config } from '../config'
import { Location, LOCATIONS } from '../constants'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { searchUnsplashPhoto } from './unsplash'

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

function getRandomPromptHints(): { category: string; continent: string; avoidCountries: string } {
  const category = LOCATION_CATEGORIES[Math.floor(Math.random() * LOCATION_CATEGORIES.length)]
  const continent = CONTINENTS[Math.floor(Math.random() * CONTINENTS.length)]

  // 随机选择一些要避免的热门国家，强制探索冷门地区
  const hotCountries = ['法国', '日本', '意大利', '美国', '英国', '中国', '西班牙', '泰国', '澳大利亚']
  const shuffled = hotCountries.sort(() => Math.random() - 0.5)
  const avoidCountries = shuffled.slice(0, 3 + Math.floor(Math.random() * 4)).join('、')

  return { category, continent, avoidCountries }
}

const LOCATION_GENERATION_PROMPT = `你是一位资深旅行探险家，专门发掘世界各地的独特目的地。

你的任务是生成一个真实存在的旅游目的地。要求：
1. 地点必须真实存在，可以是著名景点，也可以是小众秘境
2. 提供准确的地理信息
3. 尽量选择有趣、独特、不常见的地点
4. 避免总是选择最热门的旅游景点

请严格按照以下JSON格式输出（不要包含任何其他文字）：
{
  "country": "国家英文名",
  "countryZh": "国家中文名",
  "city": "城市/地区名",
  "landmark": "地标英文名",
  "landmarkZh": "地标中文名",
  "timezone": "IANA时区字符串",
  "landscapeUrl": "https://images.unsplash.com/featured/?地标英文名"
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

  try {
    ctx.logger('pig').info(`Using LLM to generate location with model: ${config.llmLocationModel}`)

    const modelRef = await ctx.chatluna.createChatModel(config.llmLocationModel)
    const model = modelRef.value

    if (!model) {
      ctx.logger('pig').warn(`Failed to create model: ${config.llmLocationModel}`)
      return getRandomStaticLocation()
    }

    // 生成随机提示增加多样性
    const hints = getRandomPromptHints()
    const userPrompt = `请生成一个位于【${hints.continent}】的【${hints.category}】类型的旅游目的地。

特别要求：这次请避开 ${hints.avoidCountries} 这些热门国家，选择一个更独特、更少人知道的地方。

直接输出JSON，不要有任何其他文字。`

    if (config.debug) ctx.logger('pig').debug(`Location prompt hints: ${hints.continent}, ${hints.category}`)

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
      ctx.logger('pig').info(`LLM generated location: ${location.landmarkZh} (${location.landmark}), ${location.countryZh}`)

      // Try to get a real photo URL from Unsplash API with multiple search attempts
      if (config.unsplashAccessKey) {
        // Build search queries in order of specificity
        const searchQueries = [
          `${location.landmark} ${location.country}`,           // Most specific: landmark + country
          location.city ? `${location.city} ${location.country}` : null,  // City + country
          `${location.country} landscape`,                       // Country landscape
          location.country,                                      // Just country name
        ].filter(Boolean) as string[]

        let photoUrl: string | null = null
        for (const query of searchQueries) {
          if (config.debug) ctx.logger('pig').debug(`Searching Unsplash for: ${query}`)
          photoUrl = await searchUnsplashPhoto(ctx, config.unsplashAccessKey, query, config.debug)
          if (photoUrl) {
            if (config.debug) ctx.logger('pig').info(`Using Unsplash photo: ${photoUrl}`)
            location.landscapeUrl = photoUrl
            break
          }
        }

        if (!photoUrl && config.debug) {
          ctx.logger('pig').debug('All Unsplash searches returned no results, using LLM-generated URL')
        }
      }

      return location
    }

    ctx.logger('pig').warn('Failed to parse LLM response, falling back to static locations')
    return getRandomStaticLocation()
  } catch (e) {
    ctx.logger('pig').error(`LLM location generation failed: ${e}`)
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
      location.landscapeUrl = `https://images.unsplash.com/featured/?${encodeURIComponent(location.landmark)},${encodeURIComponent(location.country)}`
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
