import { Context } from 'koishi'
import { promises as fs } from 'fs'
import { Config } from '../config'
import { PigTravelLog } from '../database'
import { getPigSvgDataUrlByName, getPigSvgDirResolved, getRandomPigSvgDataUrl } from './pig-icon'
import { getAdminBackgroundImage } from './background'

export interface MonthlySummaryData {
  userId: string
  platform: string
  username: string
  avatarUrl: string
  year: number
  month: number
  logs: PigTravelLog[]
  totalTrips: number
  countriesVisited: string[]
  locationsVisited: string[]
  backgroundImage?: string
}

export interface MonthlySummaryGroupUser {
  userId: string
  platform: string
  username: string
  avatarUrl: string
  totalTrips: number
  countriesCount: number
  locationsCount: number
}

export interface MonthlySummaryGroupData {
  year: number
  month: number
  totalUsers: number
  totalTrips: number
  countriesVisited: string[]
  locationsVisited: string[]
  users: MonthlySummaryGroupUser[]
  backgroundImage?: string
}

export interface SummaryCardResult {
  buffer: Buffer
  filename: string
}

/**
 * 获取指定用户指定月份的旅行记录
 */
export async function getMonthlyLogs(
  ctx: Context,
  userId: string,
  platform: string,
  year: number,
  month: number,
  guildId?: string
): Promise<PigTravelLog[]> {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const logs = await ctx.database.get('pig_travel_log', {
    userId,
    platform,
    ...(guildId ? { guildId } : {}),
    timestamp: {
      $gte: startDate,
      $lt: endDate
    }
  })

  // Sort by timestamp
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return logs
}

/**
 * 获取所有有旅行记录的用户（指定月份）
 */
export async function getUsersWithLogsInMonth(
  ctx: Context,
  year: number,
  month: number,
  guildId?: string
): Promise<{ userId: string; platform: string }[]> {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const logs = await ctx.database.get('pig_travel_log', {
    ...(guildId ? { guildId } : {}),
    timestamp: {
      $gte: startDate,
      $lt: endDate
    }
  })

  // Deduplicate users
  const userMap = new Map<string, { userId: string; platform: string }>()
  for (const log of logs) {
    const key = `${log.platform}:${log.userId}`
    if (!userMap.has(key)) {
      userMap.set(key, { userId: log.userId, platform: log.platform })
    }
  }

  return Array.from(userMap.values())
}

/**
 * 准备月度合照数据（按月汇总）
 */
export async function prepareMonthlySummaryGroup(
  ctx: Context,
  year: number,
  month: number,
  guildId?: string,
  profiles?: Map<string, { username?: string; avatarUrl?: string }>
): Promise<MonthlySummaryGroupData> {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const logs = await ctx.database.get('pig_travel_log', {
    ...(guildId ? { guildId } : {}),
    timestamp: {
      $gte: startDate,
      $lt: endDate
    }
  })

  const countriesSet = new Set<string>()
  const locationsSet = new Set<string>()
  const userMap = new Map<string, {
    userId: string
    platform: string
    totalTrips: number
    countries: Set<string>
    locations: Set<string>
  }>()

  for (const log of logs) {
    countriesSet.add(log.country)
    locationsSet.add(log.location)
    const key = `${log.platform}:${log.userId}`
    if (!userMap.has(key)) {
      userMap.set(key, {
        userId: log.userId,
        platform: log.platform,
        totalTrips: 0,
        countries: new Set<string>(),
        locations: new Set<string>()
      })
    }
    const entry = userMap.get(key)!
    entry.totalTrips += 1
    entry.countries.add(log.country)
    entry.locations.add(log.location)
  }

  const users: MonthlySummaryGroupUser[] = Array.from(userMap.values()).map(entry => {
    const profile = profiles?.get(`${entry.platform}:${entry.userId}`)
    const username = profile?.username || entry.userId
    const avatarUrl = profile?.avatarUrl || ''
    return {
      userId: entry.userId,
      platform: entry.platform,
      username,
      avatarUrl,
      totalTrips: entry.totalTrips,
      countriesCount: entry.countries.size,
      locationsCount: entry.locations.size
    }
  })

  users.sort((a, b) => b.totalTrips - a.totalTrips)

  return {
    year,
    month,
    totalUsers: users.length,
    totalTrips: logs.length,
    countriesVisited: Array.from(countriesSet),
    locationsVisited: Array.from(locationsSet),
    users
  }
}

/**
 * 将 IANA 时区字符串转换为简短的 UTC 偏移量显示
 * 例如: "Asia/Tokyo" -> "UTC+9", "America/New_York" -> "UTC-5"
 */
function formatTimezone(timezone: string): string {
  if (!timezone || timezone === 'UTC') return 'UTC'

  try {
    // 使用 Intl API 获取时区偏移
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    })
    const parts = formatter.formatToParts(now)
    const tzPart = parts.find(p => p.type === 'timeZoneName')
    if (tzPart) {
      // 格式如 "GMT+9" 或 "GMT-5"，转换为 "UTC+9"
      return tzPart.value.replace('GMT', 'UTC')
    }
  } catch {
    // 如果时区无效，返回原始值或 UTC
  }

  // 如果时区已经是 UTC+X 格式，直接返回
  if (timezone.startsWith('UTC')) return timezone

  return 'UTC'
}

/**
 * 生成月度总结卡片
 */
export async function generateMonthlySummaryCard(
  ctx: Context,
  config: Config,
  data: MonthlySummaryData
): Promise<SummaryCardResult> {
  const { year, month, logs, username, totalTrips, countriesVisited, locationsVisited, backgroundImage } = data
  let { avatarUrl } = data

  // 默认占位符背景
  const defaultBgUrl = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073&auto=format&fit=crop'

  // 处理背景图片：如果是本地文件，转换为 base64
  let bgUrl = defaultBgUrl
  if (backgroundImage) {
    if (backgroundImage.startsWith('file://')) {
      try {
        const filePath = backgroundImage.replace('file://', '')
        const buffer = await fs.readFile(filePath)
        // 根据文件扩展名确定 MIME 类型
        let mimeType = 'image/png'
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg'
        else if (filePath.endsWith('.gif')) mimeType = 'image/gif'
        else if (filePath.endsWith('.webp')) mimeType = 'image/webp'
        bgUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
        if (config.debug) ctx.logger('pig').debug(`Loaded local background: ${filePath}`)
      } catch (e) {
        ctx.logger('pig').warn(`Failed to load local background: ${e}`)
        // 使用默认背景
      }
    } else {
      bgUrl = backgroundImage
    }
  }

  // 预取头像并转换为 base64（解决 QQ 头像跨域问题）
  if (avatarUrl && avatarUrl.startsWith('http')) {
    try {
      if (config.debug) ctx.logger('pig').debug(`Fetching avatar: ${avatarUrl}`)
      const response = await ctx.http(avatarUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'image/*',
        },
      })
      const buffer = Buffer.from(response.data as ArrayBuffer)
      const contentType = response.headers?.['content-type'] || 'image/jpeg'
      avatarUrl = `data:${contentType};base64,${buffer.toString('base64')}`
      if (config.debug) ctx.logger('pig').debug(`Avatar fetched successfully, size: ${buffer.length}`)
    } catch (e) {
      if (config.debug) ctx.logger('pig').warn(`Failed to fetch avatar: ${e}`)
      // 使用默认头像
      avatarUrl = ''
    }
  }

  // 月份名称
  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  const monthName = monthNames[month - 1]
  let pigSvg = await getRandomPigSvgDataUrl()
  if (!pigSvg) {
    pigSvg = await getPigSvgDataUrlByName('pig.svg')
  }
  if (!pigSvg && config.debug) {
    const svgDir = await getPigSvgDirResolved()
    ctx.logger('pig').warn(`Pig SVG not available, fallback emoji (dir=${svgDir ?? 'none'})`)
  }
  const pigTitle = pigSvg
    ? `<img class="pig-emoji pig-emoji--title" src="${pigSvg}" alt="pig" />`
    : '<span class="pig-emoji-fallback">🐷</span>'
  const pigEmpty = pigSvg
    ? `<img class="pig-emoji pig-emoji--empty" src="${pigSvg}" alt="pig" />`
    : '<span class="pig-emoji-fallback">🐷</span>'

  // 生成旅行足迹列表 HTML
  const tripsHtml = logs.slice(0, 12).map((log, index) => {
    const date = new Date(log.timestamp)
    const dayStr = `${date.getMonth() + 1}/${date.getDate()}`
    const tz = formatTimezone(log.timezone)
    return `
      <div class="trip-item">
        <div class="trip-index">#${String(index + 1).padStart(2, '0')}</div>
        <div class="trip-content">
          <div class="trip-loc">${escapeHtml(log.locationZh || log.location)}</div>
          <div class="trip-meta">
            <span class="trip-tag">${escapeHtml(log.countryZh || log.country)}</span>
            <span>${dayStr}</span>
          </div>
        </div>
        <div class="trip-tz">${tz}</div>
      </div>
    `
  }).join('')

  // 如果超过12条，显示省略
  const moreTripsHtml = logs.length > 12
    ? `<div class="more-trips">... And ${logs.length - 12} more journeys ...</div>`
    : ''

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;700&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    width: 1080px;
    min-height: 1920px;
    font-family: "Noto Sans SC", sans-serif;
    background-color: #F7F5F2; /* 纸张米色 */
    color: #1A1A1A;
    padding: 0;
  }

  .container {
    padding: 80px;
    position: relative;
    background: #F7F5F2; /* 默认纸张米色，会被自定义背景覆盖 */
    min-height: 1920px;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 防止背景溢出 */
  }

  /* 自定义背景层 */
  .custom-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    opacity: 0.15; /* 降低不透明度作为背景纹理 */
    background-image: url('${bgUrl}');
    background-size: cover;
    background-position: center;
    filter: grayscale(100%); /* 默认黑白，保持杂志格调 */
    pointer-events: none;
  }

  /* 杂志顶部条形码/期号区域 */
  .magazine-meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 4px solid #1A1A1A;
    padding-bottom: 20px;
    margin-bottom: 60px;
    position: relative;
    z-index: 2;
  }

  .issue-no {
    font-family: "Noto Serif SC", serif;
    font-size: 24px;
    font-weight: 700;
    font-style: italic;
  }

  .meta-date {
    font-size: 18px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 2px;
  }

  /* 标题区域 */
  .title-section {
    margin-bottom: 80px;
    position: relative;
    z-index: 2;
  }

  .main-title {
    font-family: "Noto Serif SC", serif;
    font-size: 160px;
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -5px;
    color: #1A1A1A;
    margin-left: -10px;
  }

  .pig-emoji {
    display: inline-block;
    width: 1em;
    height: 1em;
    vertical-align: -0.12em;
    object-fit: contain;
  }

  .pig-emoji--title {
    width: 0.65em;
    height: 0.65em;
  }

  .pig-emoji--empty {
    width: 110px;
    height: 110px;
  }

  .pig-emoji-fallback {
    font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
    vertical-align: -0.08em;
  }

  .sub-title {
    font-size: 32px;
    font-weight: 300;
    text-transform: uppercase;
    letter-spacing: 12px;
    margin-top: 10px;
    color: #666;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .sub-title::after {
    content: "";
    flex: 1;
    height: 2px;
    background: #1A1A1A;
  }

  /* 用户档案卡片 - 杂志专栏风格 */
  .profile-section {
    display: flex;
    gap: 60px;
    margin-bottom: 80px;
    align-items: flex-start;
  }

  .avatar-frame {
    width: 200px;
    height: 200px;
    border: 1px solid #1A1A1A;
    padding: 10px;
    background: #fff;
    transform: rotate(-3deg);
    box-shadow: 15px 15px 0 rgba(0,0,0,0.1);
  }

  .avatar {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* filter: grayscale(20%) contrast(1.1); */
  }

  .user-details {
    flex: 1;
    padding-top: 10px;
  }

  .username {
    font-family: "Noto Serif SC", serif;
    font-size: 64px;
    font-weight: 700;
    margin-bottom: 16px;
    letter-spacing: -1px;
    line-height: 1.1;
  }

  .user-role {
    font-size: 20px;
    text-transform: uppercase;
    letter-spacing: 4px;
    color: #fff;
    background: #1A1A1A;
    display: inline-block;
    padding: 8px 16px;
    font-weight: 700;
  }

  /* 数据统计网格 - 极简主义 */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 40px;
    margin-bottom: 80px;
    border-top: 2px solid #1A1A1A;
    border-bottom: 2px solid #1A1A1A;
    padding: 60px 0;
  }

  .stat-item {
    text-align: center;
    position: relative;
  }

  .stat-item:not(:last-child)::after {
    content: "";
    position: absolute;
    right: 0;
    top: 20%;
    height: 60%;
    width: 1px;
    background: #ccc;
  }

  .stat-value {
    font-family: "Noto Serif SC", serif;
    font-size: 100px;
    font-weight: 400;
    line-height: 1;
    margin-bottom: 16px;
    color: #1A1A1A;
  }

  .stat-value.highlight-pink { color: #FF9AA2; }
  .stat-value.highlight-blue { color: #A0C4FF; }
  .stat-value.highlight-yellow { color: #FFDAC1; }

  .stat-label {
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: #888;
    font-weight: 700;
  }

  /* 旅行列表 - 目录风格 */
  .trips-section {
    flex: 1;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 40px;
    border-bottom: 1px solid #1A1A1A;
    padding-bottom: 15px;
  }

  .section-title {
    font-family: "Noto Serif SC", serif;
    font-size: 40px;
    font-weight: 700;
  }

  .section-subtitle {
    font-size: 18px;
    color: #888;
    font-style: italic;
    font-family: "Noto Serif SC", serif;
  }

  .trips-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .trip-item {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 24px;
    padding: 24px 0;
    border-bottom: 1px dashed #ccc;
    align-items: center;
  }

  .trip-index {
    font-family: "Noto Serif SC", serif;
    font-size: 32px;
    font-style: italic;
    color: #ccc;
  }

  .trip-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .trip-loc {
    font-size: 32px;
    font-weight: 700;
    color: #1A1A1A;
  }

  .trip-meta {
    font-size: 16px;
    color: #666;
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .trip-tag {
    background: #E0D8D0;
    padding: 4px 10px;
    font-size: 14px;
    border-radius: 2px;
    font-weight: 700;
    color: #444;
  }

  .trip-tz {
    font-family: monospace;
    font-size: 16px;
    color: #888;
    border: 1px solid #ccc;
    padding: 4px 8px;
  }

  .more-trips {
    text-align: center;
    padding: 40px;
    font-style: italic;
    color: #888;
    font-family: "Noto Serif SC", serif;
    font-size: 20px;
  }

  /* 底部品牌区 */
  .footer {
    margin-top: auto;
    padding-top: 60px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .brand-logo {
    font-family: "Noto Serif SC", serif;
    font-size: 40px;
    font-weight: 900;
    letter-spacing: -1px;
    border: 4px solid #1A1A1A;
    padding: 10px 20px;
  }

  .barcode {
    height: 50px;
    width: 240px;
    background: repeating-linear-gradient(
      90deg,
      #1A1A1A 0px,
      #1A1A1A 2px,
      transparent 2px,
      transparent 4px,
      #1A1A1A 4px,
      #1A1A1A 8px,
      transparent 8px,
      transparent 9px
    );
  }

  /* 装饰背景字 */
  .bg-text {
    position: absolute;
    top: 45%;
    right: -100px;
    transform: rotate(90deg);
    font-size: 300px;
    font-weight: 900;
    color: rgba(0,0,0,0.03);
    z-index: 0;
    pointer-events: none;
    white-space: nowrap;
    font-family: "Noto Serif SC", serif;
  }

  .empty-state {
    text-align: center;
    padding: 120px 0;
    color: #888;
  }

  .empty-icon {
    font-size: 100px;
    margin-bottom: 40px;
    opacity: 0.5;
  }

  .empty-text {
    font-size: 32px;
    font-family: "Noto Serif SC", serif;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="custom-bg"></div>
    <div class="bg-text">JOURNEY</div>

    <div class="magazine-meta">
      <div class="issue-no">VOL.${year}.${month.toString().padStart(2, '0')}</div>
      <div class="meta-date">${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</div>
    </div>

    <div class="title-section">
      <div class="sub-title">MONTHLY REPORT</div>
      <div class="main-title">SUMMARY ${pigTitle}</div>
    </div>

    <div class="profile-section">
      <div class="avatar-frame">
        <img class="avatar" src="${avatarUrl || 'https://ui-avatars.com/api/?name=U&background=333&color=fff'}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=333&color=fff'" />
      </div>
      <div class="user-details">
        <div class="username">${escapeHtml(username)}</div>
        <div class="user-role">TRAVELER / ${year}年${monthName}</div>
      </div>
    </div>

    ${totalTrips > 0 ? `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value highlight-yellow">${totalTrips}</div>
        <div class="stat-label">TRIPS</div>
      </div>
      <div class="stat-item">
        <div class="stat-value highlight-pink">${countriesVisited.length}</div>
        <div class="stat-label">COUNTRIES</div>
      </div>
      <div class="stat-item">
        <div class="stat-value highlight-blue">${locationsVisited.length}</div>
        <div class="stat-label">LOCATIONS</div>
      </div>
    </div>

    <div class="trips-section">
      <div class="section-header">
        <div class="section-title">Travel Log</div>
        <div class="section-subtitle">Record of your journey</div>
      </div>

      <div class="trips-list">
        ${tripsHtml}
        ${moreTripsHtml}
      </div>
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-icon">${pigEmpty}</div>
      <div class="empty-text">No travel records this month.</div>
    </div>
    `}

    <div class="footer">
      <div class="barcode"></div>
      <div class="brand-logo">PIG TRAVEL</div>
    </div>
  </div>

  <script>
    async function waitForImages() {
      const images = Array.from(document.images);
      const promises = images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      });
      await Promise.all([
        ...promises,
        document.fonts.ready
      ]);
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
      page.on('console', msg => ctx.logger('pig').debug(`[Summary] ${msg.text()}`))
    }

    // 动态高度
    const baseHeight = 1200
    const tripHeight = Math.min(logs.length, 12) * 110
    const extraHeight = logs.length > 12 ? 80 : 0
    const totalHeight = baseHeight + tripHeight + extraHeight + (logs.length === 0 ? 0 : 0)

    await page.setViewport({ width: 1080, height: Math.max(1920, totalHeight), deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => window['renderReady'])

    const buffer = await page.screenshot({ type: 'png', fullPage: true }) as Buffer
    const filename = `pig_summary_${data.userId}_${year}_${month}.png`

    ctx.logger('pig').info(`月度总结卡片已生成: ${filename}`)
    return { buffer, filename }
  } catch (e) {
    ctx.logger('pig').error('Failed to generate summary card', e)
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

/**
 * 生成月度合照卡片
 */
export async function generateMonthlySummaryGroupCard(
  ctx: Context,
  config: Config,
  data: MonthlySummaryGroupData
): Promise<SummaryCardResult> {
  const { year, month, totalUsers, totalTrips, countriesVisited, locationsVisited, users, backgroundImage } = data

  const defaultBgUrl = 'https://images.unsplash.com/photo-1507525428034-b723cf9661d3e?q=80&w=2073&auto=format&fit=crop'
  let bgUrl = defaultBgUrl
  if (backgroundImage) {
    if (backgroundImage.startsWith('file://')) {
      try {
        const filePath = backgroundImage.replace('file://', '')
        const buffer = await fs.readFile(filePath)
        let mimeType = 'image/png'
        if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg'
        else if (filePath.endsWith('.gif')) mimeType = 'image/gif'
        else if (filePath.endsWith('.webp')) mimeType = 'image/webp'
        bgUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
        if (config.debug) ctx.logger('pig').debug(`Loaded local background: ${filePath}`)
      } catch (e) {
        ctx.logger('pig').warn(`Failed to load local background: ${e}`)
      }
    } else {
      bgUrl = backgroundImage
    }
  }

  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  const monthName = monthNames[month - 1]

  const perRow = 4
  const rowCount = Math.ceil(users.length / perRow)
  const cardRows = users.map((user) => {
    const safeName = escapeHtml(user.username || user.userId)
    const safeId = escapeHtml(user.userId)
    const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.username || user.userId)}&background=333&color=fff`
    const avatar = user.avatarUrl || avatarFallback
    return `
      <div class="user-card">
        <div class="user-avatar">
          <img src="${avatar}" onerror="this.src='${avatarFallback}'" />
        </div>
        <div class="user-info">
          <div class="user-name">${safeName}</div>
          <div class="user-id">${safeId}</div>
        </div>
        <div class="user-stats">
          <span>${user.totalTrips} trips</span>
          <span>${user.countriesCount} countries</span>
          <span>${user.locationsCount} locations</span>
        </div>
      </div>
    `
  }).join('')

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@300;400;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px;
    font-family: "Noto Sans SC", sans-serif;
    background-color: #F7F5F2;
    color: #1A1A1A;
  }

  .container {
    padding: 70px 70px 90px;
    position: relative;
    background: #F7F5F2;
    overflow: hidden;
  }

  .custom-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    opacity: 0.12;
    background-image: url('${bgUrl}');
    background-size: cover;
    background-position: center;
    filter: grayscale(100%);
    pointer-events: none;
  }

  .header {
    position: relative;
    z-index: 2;
    margin-bottom: 40px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 3px solid #1A1A1A;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }

  .issue {
    font-family: "Noto Serif SC", serif;
    font-size: 22px;
    font-weight: 700;
    font-style: italic;
  }

  .header-date {
    font-size: 16px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .title {
    font-family: "Noto Serif SC", serif;
    font-size: 96px;
    font-weight: 900;
    letter-spacing: -3px;
    line-height: 0.9;
  }

  .subtitle {
    font-size: 28px;
    font-weight: 300;
    text-transform: uppercase;
    letter-spacing: 10px;
    color: #666;
    margin-top: 8px;
  }

  .stats {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    padding: 30px 0 40px;
    border-top: 2px solid #1A1A1A;
    border-bottom: 2px solid #1A1A1A;
    margin-bottom: 40px;
  }

  .stat-item {
    text-align: center;
  }

  .stat-value {
    font-family: "Noto Serif SC", serif;
    font-size: 72px;
    line-height: 1;
  }

  .stat-label {
    font-size: 14px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #888;
    font-weight: 700;
  }

  .user-grid {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(${perRow}, 1fr);
    gap: 18px;
  }

  .user-card {
    border: 1px solid #1A1A1A;
    background: #fff;
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .user-avatar {
    width: 100%;
    aspect-ratio: 1 / 1;
    border: 1px solid #1A1A1A;
    overflow: hidden;
    background: #f0f0f0;
  }

  .user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .user-name {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.1;
  }

  .user-id {
    font-size: 14px;
    color: #666;
    letter-spacing: 0.5px;
  }

  .user-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 14px;
    color: #444;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .footer {
    position: relative;
    z-index: 2;
    margin-top: 50px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .brand-logo {
    font-family: "Noto Serif SC", serif;
    font-size: 36px;
    font-weight: 900;
    border: 3px solid #1A1A1A;
    padding: 8px 18px;
  }

  .barcode {
    height: 46px;
    width: 220px;
    background: repeating-linear-gradient(
      90deg,
      #1A1A1A 0px,
      #1A1A1A 2px,
      transparent 2px,
      transparent 4px,
      #1A1A1A 4px,
      #1A1A1A 8px,
      transparent 8px,
      transparent 9px
    );
  }
</style>
</head>
<body>
  <div class="container">
    <div class="custom-bg"></div>

    <div class="header">
      <div class="header-top">
        <div class="issue">VOL.${year}.${month.toString().padStart(2, '0')}</div>
        <div class="header-date">${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</div>
      </div>
      <div class="title">GROUP SUMMARY</div>
      <div class="subtitle">${year}年${monthName} · 旅行大合照</div>
    </div>

    <div class="stats">
      <div class="stat-item">
        <div class="stat-value">${totalUsers}</div>
        <div class="stat-label">Travelers</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${totalTrips}</div>
        <div class="stat-label">Trips</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${countriesVisited.length}</div>
        <div class="stat-label">Countries</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${locationsVisited.length}</div>
        <div class="stat-label">Locations</div>
      </div>
    </div>

    <div class="user-grid">
      ${cardRows}
    </div>

    <div class="footer">
      <div class="barcode"></div>
      <div class="brand-logo">PIG TRAVEL</div>
    </div>
  </div>

  <script>
    async function waitForImages() {
      const images = Array.from(document.images);
      const promises = images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      });
      await Promise.all([
        ...promises,
        document.fonts.ready
      ]);
      await new Promise(r => setTimeout(r, 120));
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
      page.on('console', msg => ctx.logger('pig').debug(`[SummaryGroup] ${msg.text()}`))
    }

    const baseHeight = 820
    const rowHeight = 250
    const totalHeight = baseHeight + rowCount * rowHeight

    await page.setViewport({ width: 1080, height: Math.max(1600, totalHeight), deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => window['renderReady'])

    const buffer = await page.screenshot({ type: 'png', fullPage: true }) as Buffer
    const filename = `pig_summary_group_${year}_${month}.png`

    ctx.logger('pig').info(`月度合照卡片已生成: ${filename}`)
    return { buffer, filename }
  } catch (e) {
    ctx.logger('pig').error('Failed to generate summary group card', e)
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

/**
 * 准备月度总结数据
 */
export async function prepareMonthlySummary(
  ctx: Context,
  userId: string,
  platform: string,
  username: string,
  avatarUrl: string,
  year: number,
  month: number,
  guildId?: string
): Promise<MonthlySummaryData> {
  const logs = await getMonthlyLogs(ctx, userId, platform, year, month, guildId)

  const countriesSet = new Set<string>()
  const locationsSet = new Set<string>()

  for (const log of logs) {
    countriesSet.add(log.country)
    locationsSet.add(log.location)
  }

  // 获取群组统一背景
  let backgroundImage: string | undefined
  if (guildId) {
    backgroundImage = await getAdminBackgroundImage(ctx, platform, guildId)
  }

  return {
    userId,
    platform,
    username,
    avatarUrl,
    year,
    month,
    logs,
    totalTrips: logs.length,
    countriesVisited: Array.from(countriesSet),
    locationsVisited: Array.from(locationsSet),
    backgroundImage
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
