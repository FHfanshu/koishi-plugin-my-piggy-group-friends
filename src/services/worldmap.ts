import { Context } from 'koishi'
import { promises as fs } from 'fs'
import { resolve } from 'path'
import { Config } from '../config'
import { getCountryISOCode, getPrimaryCountryNameEn, getPrimaryCountryNameZh } from '../utils/countryMapping'

export interface VisitedCountry {
  isoCode: string
  countryName: string
  countryNameZh: string
  visitCount: number
  firstVisit: Date
  lastVisit: Date
}

export interface WorldMapData {
  userId: string
  platform: string
  username: string
  avatarUrl: string
  visitedCountries: VisitedCountry[]
  totalCountries: number
  totalTrips: number
  firstTrip?: Date
  lastTrip?: Date
  backgroundImage?: string
  isGuildMode?: boolean
  uniqueUsers?: number
}

const TOTAL_COUNTRY_COUNT = 195
const MAP_CACHE_RELATIVE_PATH = ['data', 'pig', 'svgs', 'world-map.svg']

let cachedWorldMapSvg: string | null = null

export async function getWorldMapSvg(ctx: Context): Promise<string> {
  if (cachedWorldMapSvg) return cachedWorldMapSvg

  const mapPath = resolve(ctx.baseDir ?? process.cwd(), ...MAP_CACHE_RELATIVE_PATH)
  try {
    const file = await fs.readFile(mapPath, 'utf8')
    if (!file.includes('<svg')) {
      throw new Error('Invalid SVG content')
    }
    cachedWorldMapSvg = file
    return file
  } catch (error) {
    throw new Error(`Official world map SVG not found or invalid: ${mapPath}. ${error}`)
  }
}

export async function getUserVisitedCountries(
  ctx: Context,
  userId: string,
  platform: string,
  guildId?: string
): Promise<{
  visitedCountries: VisitedCountry[]
  totalTrips: number
  firstTrip?: Date
  lastTrip?: Date
}> {
  const query: Record<string, string> = { userId, platform }
  if (guildId) query.guildId = guildId

  const logs = await ctx.database.get('pig_travel_log', query)
  const totalTrips = logs.length

  if (!logs.length) {
    return { visitedCountries: [], totalTrips: 0 }
  }

  let firstTrip: Date | undefined
  let lastTrip: Date | undefined
  const countryMap = new Map<string, VisitedCountry>()

  for (const log of logs) {
    const visitDate = new Date(log.timestamp)
    if (!firstTrip || visitDate < firstTrip) firstTrip = visitDate
    if (!lastTrip || visitDate > lastTrip) lastTrip = visitDate

    const iso =
      getCountryISOCode(log.country) ||
      getCountryISOCode(log.countryZh) ||
      null

    if (!iso) continue

    const existing = countryMap.get(iso)
    if (!existing) {
      const canonicalNameEn = getPrimaryCountryNameEn(iso) || log.country
      const canonicalNameZh = getPrimaryCountryNameZh(iso) || log.countryZh || log.country
      countryMap.set(iso, {
        isoCode: iso,
        countryName: canonicalNameEn,
        countryNameZh: canonicalNameZh,
        visitCount: 1,
        firstVisit: visitDate,
        lastVisit: visitDate,
      })
      continue
    }

    existing.visitCount += 1
    if (visitDate < existing.firstVisit) existing.firstVisit = visitDate
    if (visitDate > existing.lastVisit) existing.lastVisit = visitDate
  }

  const visitedCountries = Array.from(countryMap.values()).sort(
    (a, b) => b.visitCount - a.visitCount
  )

  return { visitedCountries, totalTrips, firstTrip, lastTrip }
}

export async function getGuildVisitedCountries(
  ctx: Context,
  guildId: string,
  platform: string
): Promise<{
  visitedCountries: VisitedCountry[]
  totalTrips: number
  firstTrip?: Date
  lastTrip?: Date
  uniqueUsers: number
}> {
  const logs = await ctx.database.get('pig_travel_log', { guildId, platform })
  const totalTrips = logs.length

  if (!logs.length) {
    return { visitedCountries: [], totalTrips: 0, uniqueUsers: 0 }
  }

  let firstTrip: Date | undefined
  let lastTrip: Date | undefined
  const countryMap = new Map<string, VisitedCountry>()
  const userSet = new Set<string>()

  for (const log of logs) {
    userSet.add(log.userId)
    const visitDate = new Date(log.timestamp)
    if (!firstTrip || visitDate < firstTrip) firstTrip = visitDate
    if (!lastTrip || visitDate > lastTrip) lastTrip = visitDate

    const iso =
      getCountryISOCode(log.country) ||
      getCountryISOCode(log.countryZh) ||
      null

    if (!iso) continue

    const existing = countryMap.get(iso)
    if (!existing) {
      const canonicalNameEn = getPrimaryCountryNameEn(iso) || log.country
      const canonicalNameZh = getPrimaryCountryNameZh(iso) || log.countryZh || log.country
      countryMap.set(iso, {
        isoCode: iso,
        countryName: canonicalNameEn,
        countryNameZh: canonicalNameZh,
        visitCount: 1,
        firstVisit: visitDate,
        lastVisit: visitDate,
      })
      continue
    }

    existing.visitCount += 1
    if (visitDate < existing.firstVisit) existing.firstVisit = visitDate
    if (visitDate > existing.lastVisit) existing.lastVisit = visitDate
  }

  const visitedCountries = Array.from(countryMap.values()).sort(
    (a, b) => b.visitCount - a.visitCount
  )

  return { visitedCountries, totalTrips, firstTrip, lastTrip, uniqueUsers: userSet.size }
}

export async function prepareWorldMapData(
  ctx: Context,
  userId: string,
  platform: string,
  username: string,
  avatarUrl: string,
  guildId?: string,
  backgroundImage?: string
): Promise<WorldMapData> {
  const { visitedCountries, totalTrips, firstTrip, lastTrip } =
    await getUserVisitedCountries(ctx, userId, platform, guildId)

  return {
    userId,
    platform,
    username,
    avatarUrl,
    visitedCountries,
    totalCountries: visitedCountries.length,
    totalTrips,
    firstTrip,
    lastTrip,
    backgroundImage,
  }
}

export async function prepareGuildWorldMapData(
  ctx: Context,
  guildId: string,
  platform: string,
  guildName: string,
  guildAvatarUrl?: string,
  backgroundImage?: string
): Promise<WorldMapData> {
  const { visitedCountries, totalTrips, firstTrip, lastTrip, uniqueUsers } =
    await getGuildVisitedCountries(ctx, guildId, platform)

  return {
    userId: guildId,
    platform,
    username: guildName,
    avatarUrl: guildAvatarUrl || '',
    visitedCountries,
    totalCountries: visitedCountries.length,
    totalTrips,
    firstTrip,
    lastTrip,
    backgroundImage,
    isGuildMode: true,
    uniqueUsers,
  }
}

function getVisitClass(count: number): string {
  if (count >= 5) return 'visited-4'
  if (count >= 3) return 'visited-3'
  if (count >= 1) return 'visited-2'
  return ''
}

/**
 * Add visited class to country paths in SVG.
 * Supports multiple SVG formats:
 * - id="NO" (ISO code)
 * - name="Norway" (full name)
 * - class="Norway" (SimpleMaps format)
 */
export function processMapSvg(svgContent: string, visitedCountries: VisitedCountry[]): string {
  let svg = svgContent

  for (const country of visitedCountries) {
    const isoCode = country.isoCode.toUpperCase()
    const englishName = country.countryName
    const visitClass = `visited ${getVisitClass(country.visitCount)}`

    // Pattern 1: Match by id="XX" (ISO code)
    const idRegex = new RegExp(`(<[^>]*\\bid=["']${isoCode}["'][^>]*)(>)`, 'gi')
    svg = svg.replace(idRegex, (match, prefix, suffix) => {
      return addClassToElement(prefix, suffix, visitClass)
    })

    // Pattern 2: Match by name="CountryName"
    if (englishName) {
      const nameRegex = new RegExp(`(<[^>]*\\bname=["']${escapeRegex(englishName)}["'][^>]*)(>)`, 'gi')
      svg = svg.replace(nameRegex, (match, prefix, suffix) => {
        return addClassToElement(prefix, suffix, visitClass)
      })
    }

    // Pattern 3: Match by class="CountryName" (SimpleMaps SVG format)
    // This SVG uses class="Norway" instead of id="NO"
    if (englishName) {
      const classNameRegex = new RegExp(`(<[^>]*\\bclass=["']${escapeRegex(englishName)}["'][^>]*)(>)`, 'gi')
      svg = svg.replace(classNameRegex, (match, prefix, suffix) => {
        // Replace the existing class with merged class
        const existingClassRegex = /\bclass=["']([^"']*)["']/
        const newPrefix = prefix.replace(existingClassRegex, (m: string, cls: string) => {
          const merged = `${cls} ${visitClass}`.trim()
          return `class="${merged}"`
        })
        return newPrefix + suffix
      })
    }
  }

  return svg
}

function addClassToElement(prefix: string, suffix: string, className: string): string {
  const classRegex = /\bclass=["']([^"']*)["']/
  if (classRegex.test(prefix)) {
    return prefix.replace(classRegex, (m, cls) => {
      // Avoid adding duplicate classes
      if (cls.includes('visited')) return m
      const merged = `${cls} ${className}`.trim()
      return `class="${merged}"`
    }) + suffix
  }
  return `${prefix} class="${className}"${suffix}`
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasCountrySelectablePaths(svgContent: string): boolean {
  return /<path\b[^>]*\b(id|name|class)=["'][^"']+["']/i.test(svgContent)
}

function buildTiandituStaticImageUrl(config: Config): string {
  if (!config.worldMapUseTianditu) return ''
  const token = config.tiandituToken?.trim()
  if (!token) return ''
  const params = new URLSearchParams({
    width: '2392',
    height: '1530',
    zoom: '1',
    center: '0,20',
    layers: 'img_w',
    tk: token,
  })
  return `https://api.tianditu.gov.cn/staticimage?${params.toString()}`
}

export async function generateWorldMapCard(
  ctx: Context,
  config: Config,
  data: WorldMapData
): Promise<{ buffer: Buffer; filename: string }> {
  const svg = await getWorldMapSvg(ctx)
  const svgSupportsHighlight = hasCountrySelectablePaths(svg)
  const highlightEnabled = !config.worldMapOfficialOnly && svgSupportsHighlight
  const processedSvg = highlightEnabled ? processMapSvg(svg, data.visitedCountries) : svg
  const tiandituMapUrl = buildTiandituStaticImageUrl(config)

  const topDestinations = data.visitedCountries.slice(0, 6)
  const exploredRate = TOTAL_COUNTRY_COUNT
    ? Math.min(100, Math.round((data.totalCountries / TOTAL_COUNTRY_COUNT) * 100))
    : 0

  const username = escapeHtml(data.username || data.userId)
  const avatarUrl = data.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(username.charAt(0) || 'U')}&background=333&color=fff`
  const isGuildMode = data.isGuildMode || false
  const uniqueUsers = data.uniqueUsers || 0

  // 处理背景图片：如果是本地文件，转换为 base64
  let bgUrl = ''
  if (data.backgroundImage) {
    if (data.backgroundImage.startsWith('file://')) {
      try {
        const filePath = data.backgroundImage.replace('file://', '')
        const buffer = await fs.readFile(filePath)
        let mimeType = 'image/png'
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg'
        else if (filePath.endsWith('.gif')) mimeType = 'image/gif'
        else if (filePath.endsWith('.webp')) mimeType = 'image/webp'
        bgUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
      } catch (e) {
        ctx.logger('pig').warn(`Failed to load local background: ${e}`)
      }
    } else {
      bgUrl = data.backgroundImage
    }
  }

  const formatDate = (date?: Date) => {
    if (!date) return '--'
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const currentDate = new Date()
  const year = currentDate.getFullYear()
  const monthStr = currentDate.toLocaleString('en-US', { month: 'long' }).toUpperCase()
  const volStr = `VOL.${year}.${String(currentDate.getMonth() + 1).padStart(2, '0')}`
  const mapModeClass = highlightEnabled ? 'highlight-mode' : 'official-mode'
  const tiandituTimeoutMs = Math.max(1000, config.tiandituTimeoutMs || 5000)
  const mapNoteText = highlightEnabled
    ? 'Projection: Mercator · Country fill enabled'
    : 'Base: Official SVG · Country fill disabled'
  const mapSourceText = tiandituMapUrl
    ? 'Tianditu: browser mode (auto fallback)'
    : 'Tianditu: off'

  const destinationsHtml = topDestinations.length
    ? topDestinations.map((item, index) => {
      const rank = String(index + 1).padStart(2, '0')
      return `
        <div class="destination-item">
          <div class="destination-rank">#${rank}</div>
          <div class="destination-name">
            <span class="zh-name">${escapeHtml(item.countryNameZh)}</span>
            <span class="en-name">/ ${escapeHtml(item.countryName)}</span>
          </div>
          <div class="destination-count">${item.visitCount} 次</div>
        </div>
      `
    }).join('')
    : `<div class="destination-empty">还没有旅行记录</div>`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;700&display=swap');

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      width: 1000px;
      font-family: "Noto Sans SC", sans-serif;
      background: #f7f5f2;
      color: #1a1a1a;
      overflow: hidden;
    }

    .container {
      padding: 60px;
      position: relative;
      background: #F7F5F2;
      min-height: 1400px;
    }

    /* 背景装饰层 */
    .custom-bg {
      position: absolute;
      inset: 0;
      background-image: url('${bgUrl}');
      background-size: cover;
      background-position: center;
      opacity: 0.15;
      filter: grayscale(100%);
      z-index: 0;
    }

    .paper-texture {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px);
      background-size: 4px 4px;
      opacity: 0.4;
      z-index: 0;
      pointer-events: none;
    }

    .bg-text {
      position: absolute;
      top: 35%;
      right: -80px;
      transform: rotate(90deg);
      font-family: "Noto Serif SC", serif;
      font-size: 180px;
      font-weight: 900;
      color: rgba(0,0,0,0.03);
      z-index: 0;
      white-space: nowrap;
      pointer-events: none;
    }

    /* 顶部信息 */
    .meta-header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 8px;
      margin-bottom: 40px;
      font-size: 14px;
      letter-spacing: 2px;
      font-weight: 700;
      position: relative;
      z-index: 1;
    }

    /* 主标题区 */
    .header-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 50px;
      position: relative;
      z-index: 1;
    }

    .title-group {
      flex: 1;
    }

    .main-title {
      font-family: "Noto Serif SC", serif;
      font-size: 100px;
      font-weight: 900;
      line-height: 0.9;
      letter-spacing: -4px;
      margin-left: -5px;
      color: #1a1a1a;
    }

    .sub-title {
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 8px;
      color: #666;
      margin-top: 16px;
      font-weight: 300;
    }

    /* 拍立得风格头像 */
    .profile-card {
      position: relative;
      margin-right: 20px;
      margin-top: 10px;
    }

    .avatar-frame {
      width: 140px;
      height: 140px;
      background: #fff;
      border: 1px solid #1a1a1a;
      padding: 6px;
      transform: rotate(-3deg);
      box-shadow: 8px 8px 0 rgba(0,0,0,0.15);
      position: relative;
      z-index: 2;
    }

    .avatar {
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: grayscale(20%);
    }

    .username-tag {
      position: absolute;
      bottom: -20px;
      right: -30px;
      background: #1a1a1a;
      color: #fff;
      padding: 4px 12px;
      font-family: "Noto Serif SC", serif;
      font-weight: 700;
      font-size: 16px;
      transform: rotate(-3deg);
      z-index: 3;
      box-shadow: 4px 4px 0 rgba(0,0,0,0.1);
    }

    /* 群组徽章 */
    .guild-badge {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 30px;
      border: 2px solid #1a1a1a;
      background: #fff;
      box-shadow: 8px 8px 0 rgba(0,0,0,0.15);
    }

    .guild-avatar {
      width: 80px;
      height: 80px;
      object-fit: cover;
      border-radius: 50%;
      margin-bottom: 10px;
      border: 2px solid #1a1a1a;
    }

    .guild-icon {
      font-size: 60px;
      margin-bottom: 10px;
    }

    .guild-name {
      font-family: "Noto Serif SC", serif;
      font-weight: 700;
      font-size: 18px;
      color: #1a1a1a;
      text-align: center;
    }

    /* 统计网格 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 40px;
      border-top: 1px solid #1a1a1a;
      border-bottom: 1px solid #1a1a1a;
      padding: 30px 0;
      margin-bottom: 50px;
      position: relative;
      z-index: 1;
    }

    .stats-grid.four-cols {
      grid-template-columns: repeat(4, 1fr);
      gap: 30px;
    }

    .stat-item {
      text-align: center;
      position: relative;
    }

    .stat-item:not(:last-child):after {
      content: "";
      position: absolute;
      right: -20px;
      top: 10%;
      height: 80%;
      width: 1px;
      background: #ddd;
    }

    .stat-value {
      font-family: "Noto Serif SC", serif;
      font-size: 64px;
      font-weight: 700;
      color: #1a1a1a;
      line-height: 1;
    }

    .stat-value.highlight-pink { color: #FF9AA2; }
    .stat-value.highlight-blue { color: #A0C4FF; }
    .stat-value.highlight-green { color: #90BE6D; }

    .stat-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: #888;
      margin-top: 10px;
      font-weight: 700;
    }

    /* 地图容器 */
    .map-section {
      margin-bottom: 50px;
      position: relative;
      z-index: 1;
    }

    .map-header {
      font-family: "Noto Serif SC", serif;
      font-size: 24px;
      font-weight: 700;
      font-style: italic;
      margin-bottom: 20px;
      color: #444;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .map-note {
      font-family: "Noto Sans SC", sans-serif;
      font-size: 12px;
      font-style: normal;
      color: #999;
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: 1px;
      text-align: right;
      line-height: 1.6;
    }

    .map-note .map-source {
      color: #7c7c7c;
    }

    .map-wrapper {
      background: #fff;
      border: 1px solid #1a1a1a;
      padding: 30px;
      box-shadow: 12px 12px 0 rgba(0,0,0,0.08);
      position: relative;
      overflow: hidden;
    }

    .map-tdt-image {
      position: absolute;
      inset: 30px;
      width: calc(100% - 60px);
      height: calc(100% - 60px);
      object-fit: cover;
      opacity: 0.8;
      filter: saturate(0.9) contrast(1.05);
      z-index: 0;
    }

    .map-svg-layer {
      position: relative;
      z-index: 1;
    }

    .map-wrapper.official-mode .map-svg-layer {
      background: rgba(255, 255, 255, 0.16);
    }

    .map-wrapper.official-mode svg {
      opacity: 0.96;
    }

    .map-wrapper svg {
      width: 100%;
      height: auto;
      display: block;
    }

    .map-wrapper.highlight-mode path {
      fill: #f0f0f0 !important;
      stroke: #d0d0d0;
      stroke-width: 0.5;
      transition: fill 0.3s;
    }

    .map-wrapper.highlight-mode path.visited-2 { fill: #88BDBC !important; }
    .map-wrapper.highlight-mode path.visited-3 { fill: #4F9D9D !important; }
    .map-wrapper.highlight-mode path.visited-4 { fill: #254E58 !important; }

    .legend {
      display: flex;
      gap: 24px;
      margin-top: 20px;
      justify-content: flex-end;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #666;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border: 1px solid #ccc;
    }

    /* 目的地列表 */
    .destinations-section {
      position: relative;
      z-index: 1;
    }

    .section-title {
      font-family: "Noto Serif SC", serif;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 20px;
      border-bottom: 4px solid #1a1a1a;
      display: inline-block;
      padding-bottom: 4px;
    }

    .destination-item {
      display: grid;
      grid-template-columns: 60px 1fr 100px;
      padding: 18px 0;
      border-bottom: 1px dashed #ccc;
      align-items: center;
    }

    .destination-rank {
      font-family: "Noto Serif SC", serif;
      font-size: 24px;
      font-style: italic;
      color: #ccc;
      font-weight: 700;
    }

    .destination-name {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
    }

    .en-name {
      font-size: 14px;
      color: #888;
      font-weight: 400;
      margin-left: 8px;
    }

    .destination-count {
      text-align: right;
      font-weight: 700;
      color: #666;
      font-size: 14px;
      background: #e6e1d8;
      padding: 4px 8px;
      border-radius: 2px;
    }

    .destination-empty {
      padding: 40px;
      text-align: center;
      color: #999;
      font-style: italic;
    }

    /* 底部 */
    .footer {
      margin-top: 60px;
      padding-top: 30px;
      border-top: 2px solid #1a1a1a;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      position: relative;
      z-index: 1;
    }

    .barcode {
      height: 36px;
      width: 240px;
      background: repeating-linear-gradient(
        90deg,
        #1a1a1a 0px, #1a1a1a 2px,
        transparent 2px, transparent 4px,
        #1a1a1a 4px, #1a1a1a 8px,
        transparent 8px, transparent 9px,
        #1a1a1a 9px, #1a1a1a 10px,
        transparent 10px, transparent 12px
      );
    }

    .brand-box {
      border: 2px solid #1a1a1a;
      padding: 8px 16px;
      font-family: "Noto Serif SC", serif;
      font-weight: 900;
      font-size: 24px;
      letter-spacing: 2px;
    }

    .footer-dates {
      text-align: right;
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }

  </style>
</head>
<body>
  <div class="container">
    ${bgUrl ? '<div class="custom-bg"></div>' : ''}
    <div class="paper-texture"></div>
    <div class="bg-text">FOOTPRINT</div>

    <div class="meta-header">
      <div>${volStr}</div>
      <div>${monthStr} ${year}</div>
    </div>

    <div class="header-section">
      <div class="title-group">
        <div class="main-title">${isGuildMode ? 'GUILD<br>FOOTPRINT' : 'WORLD<br>FOOTPRINT'}</div>
        <div class="subtitle">${isGuildMode ? 'GUILD TRAVEL REPORT' : 'GLOBAL TRAVEL REPORT'}</div>
      </div>

      ${isGuildMode ? `
      <div class="guild-badge">
        ${avatarUrl ? `<img class="guild-avatar" src="${avatarUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />
        <div class="guild-icon" style="display:none">🌍</div>` : `<div class="guild-icon">🌍</div>`}
        <div class="guild-name">${username}</div>
      </div>
      ` : `
      <div class="profile-card">
        <div class="avatar-frame">
          <img class="avatar" src="${avatarUrl}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=333&color=fff'"/>
        </div>
        <div class="username-tag">${username}</div>
      </div>
      `}
    </div>

    <div class="stats-grid${isGuildMode ? ' four-cols' : ''}">
      ${isGuildMode ? `
      <div class="stat-item">
        <div class="stat-value highlight-green">${uniqueUsers}</div>
        <div class="stat-label">Travelers</div>
      </div>
      ` : ''}
      <div class="stat-item">
        <div class="stat-value highlight-pink">${data.totalTrips}</div>
        <div class="stat-label">Total Trips</div>
      </div>
      <div class="stat-item">
        <div class="stat-value highlight-blue">${data.totalCountries}</div>
        <div class="stat-label">Countries Visited</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${exploredRate}%</div>
        <div class="stat-label">World Explored</div>
      </div>
    </div>

    <div class="map-section">
      <div class="map-header">
        <div>Map Visualization</div>
        <div class="map-note">
          <div>${mapNoteText}</div>
          <div class="map-source">${mapSourceText}</div>
        </div>
      </div>
      <div class="map-wrapper ${mapModeClass}">
        ${tiandituMapUrl ? `<img class="map-tdt-image" src="${tiandituMapUrl}" alt="tianditu map background" loading="eager" />` : ''}
        <div class="map-svg-layer">
          ${processedSvg}
        </div>
      </div>
      ${highlightEnabled ? `
      <div class="legend">
        <div class="legend-item"><span class="legend-color" style="background:#f0f0f0"></span> Not Visited</div>
        <div class="legend-item"><span class="legend-color" style="background:#88BDBC"></span> 1-2</div>
        <div class="legend-item"><span class="legend-color" style="background:#4F9D9D"></span> 3-4</div>
        <div class="legend-item"><span class="legend-color" style="background:#254E58"></span> 5+</div>
      </div>
      ` : `
      <div class="legend">
        <div class="legend-item"><span class="legend-color" style="background:#f0f0f0"></span> Official Border Map</div>
        <div class="legend-item">Visit intensity is shown in stats and destination ranking.</div>
      </div>
      `}
    </div>

    <div class="destinations-section">
      <div class="section-title">TOP DESTINATIONS</div>
      ${destinationsHtml}
    </div>

    <div class="footer">
      <div class="barcode"></div>
      <div>
        <div class="footer-dates">First: ${formatDate(data.firstTrip)} | Last: ${formatDate(data.lastTrip)}</div>
        <div class="brand-box">PIG TRAVEL</div>
      </div>
    </div>
  </div>

  <script>
    const tiandituTimeoutMs = ${tiandituTimeoutMs};

    function waitSingleImage(img) {
      if (img.complete) {
        if (img.classList.contains('map-tdt-image') && img.naturalWidth === 0) {
          img.style.display = 'none';
        }
        return Promise.resolve();
      }

      return new Promise(resolve => {
        let done = false;
        const settle = (ok) => {
          if (done) return;
          done = true;
          if (img.classList.contains('map-tdt-image') && !ok) {
            img.style.display = 'none';
          }
          resolve();
        };
        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        if (img.classList.contains('map-tdt-image')) {
          setTimeout(() => settle(false), tiandituTimeoutMs);
        }
      });
    }

    async function waitForImages() {
      const images = Array.from(document.images);
      const promises = images.map(img => waitSingleImage(img));
      await Promise.all([ ...promises, document.fonts.ready ]);

      const tdtImage = document.querySelector('.map-tdt-image');
      if (tdtImage && (!tdtImage.complete || tdtImage.naturalWidth === 0)) {
        tdtImage.style.display = 'none';
      }

      await new Promise(r => setTimeout(r, 100));
    }
    window.renderReady = waitForImages();
  </script>
</body>
</html>
  `

  let page: Awaited<ReturnType<Context['puppeteer']['page']>> | null = null
  try {
    page = await ctx.puppeteer.page()

    if (config.debug) {
      page.on('console', msg => ctx.logger('pig').debug(`[WorldMap] ${msg.text()}`))
    }

    // 基础高度 + 列表高度动态计算
    const baseHeight = 1400
    const extraHeight = Math.max(0, (topDestinations.length - 3) * 60)
    await page.setViewport({ width: 1000, height: baseHeight + extraHeight, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => (window as any).renderReady)
    const tiandituLoaded = await page.evaluate(() => {
      const image = document.querySelector('.map-tdt-image') as HTMLImageElement | null
      if (!image) return null
      return image.style.display !== 'none' && image.complete && image.naturalWidth > 0
    })
    if (tiandituMapUrl && tiandituLoaded === false) {
      ctx.logger('pig').warn('Tianditu map image failed to load, fallback to official SVG only')
    }

    const buffer = await page.screenshot({ type: 'png', fullPage: true }) as Buffer
    const filename = `pig_map_${data.userId}_${Date.now()}.png`
    ctx.logger('pig').info(`World map card generated: ${filename}`)
    return { buffer, filename }
  } catch (e) {
    ctx.logger('pig').error('Failed to generate world map card', e)
    throw e
  } finally {
    if (page) {
      try {
        await page.close()
      } catch (closeError) {
        if (config.debug) {
          ctx.logger('pig').warn(`Failed to close puppeteer page: ${closeError}`)
        }
      }
    }
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
