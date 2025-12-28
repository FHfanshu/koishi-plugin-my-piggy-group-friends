import { Context } from 'koishi'
import { Config } from '../config'
import { PigTravelLog } from '../database'

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
  month: number
): Promise<PigTravelLog[]> {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const logs = await ctx.database.get('pig_travel_log', {
    userId,
    platform,
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
  month: number
): Promise<{ userId: string; platform: string }[]> {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 1)

  const logs = await ctx.database.get('pig_travel_log', {
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
  const { year, month, logs, username, totalTrips, countriesVisited, locationsVisited } = data
  let { avatarUrl } = data

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

  // 生成旅行足迹列表 HTML
  const tripsHtml = logs.slice(0, 12).map((log, index) => {
    const date = new Date(log.timestamp)
    const dayStr = `${date.getMonth() + 1}/${date.getDate()}`
    const tz = formatTimezone(log.timezone)
    return `
      <div class="trip-item">
        <div class="trip-index">${index + 1}</div>
        <div class="trip-info">
          <div class="trip-location">${escapeHtml(log.locationZh || log.location)}</div>
          <div class="trip-country">${escapeHtml(log.countryZh || log.country)} · ${dayStr}</div>
          <div class="trip-location-en">${escapeHtml(log.location)}</div>
        </div>
        <div class="trip-tz">${tz}</div>
      </div>
    `
  }).join('')

  // 如果超过12条，显示省略
  const moreTripsHtml = logs.length > 12
    ? `<div class="more-trips">... 还有 ${logs.length - 12} 次旅行</div>`
    : ''

  // 统计数据
  const statsHtml = `
    <div class="stats-grid">
      <div class="stat-item bg-yellow">
        <div class="stat-value">${totalTrips}</div>
        <div class="stat-label">次旅行</div>
        <div class="deco-dot"></div>
      </div>
      <div class="stat-item bg-pink">
        <div class="stat-value">${countriesVisited.length}</div>
        <div class="stat-label">个国家</div>
        <div class="deco-line"></div>
      </div>
      <div class="stat-item bg-cyan">
        <div class="stat-value">${locationsVisited.length}</div>
        <div class="stat-label">个地点</div>
        <div class="deco-triangle"></div>
      </div>
    </div>
  `

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    width: 1080px;
    min-height: 1920px;
    font-family: "Noto Sans SC", sans-serif, "Noto Color Emoji";
    background-color: #F0F0F0;
    background-image:
      radial-gradient(#000 10%, transparent 11%),
      radial-gradient(#000 10%, transparent 11%);
    background-size: 30px 30px;
    background-position: 0 0, 15px 15px;
    background-color: #FFDEE9;
    padding: 60px;
  }

  .twemoji {
    font-family: "Twemoji", "Noto Color Emoji", sans-serif;
  }

  .container {
    background: #fff;
    border: 4px solid #000;
    box-shadow: 20px 20px 0 #000;
    padding: 60px;
    position: relative;
    overflow: hidden;
  }

  /* Memphis decorative elements */
  .deco-shape-1 {
    position: absolute;
    top: -20px;
    right: -20px;
    width: 150px;
    height: 150px;
    background: #FFD700;
    border: 4px solid #000;
    border-radius: 50%;
    z-index: 0;
  }

  .deco-shape-2 {
    position: absolute;
    bottom: 40px;
    left: -30px;
    width: 100px;
    height: 100px;
    background: #00CED1;
    border: 4px solid #000;
    transform: rotate(45deg);
    z-index: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 32px;
    margin-bottom: 48px;
    position: relative;
    z-index: 1;
    background: #fff;
    border: 4px solid #000;
    padding: 24px;
    box-shadow: 8px 8px 0 #000;
  }

  .avatar-ring {
    padding: 0;
    border: 4px solid #000;
    border-radius: 50%;
    overflow: hidden;
    background: #FF69B4;
  }

  .avatar {
    width: 120px;
    height: 120px;
    object-fit: cover;
    display: block;
  }

  .user-info {
    flex: 1;
  }

  .username {
    font-size: 48px;
    font-weight: 900;
    color: #000;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: -1px;
  }

  .period {
    font-size: 28px;
    color: #000;
    font-weight: 700;
    background: #00CED1;
    display: inline-block;
    padding: 4px 12px;
    border: 3px solid #000;
    box-shadow: 4px 4px 0 #000;
  }

  .title-section {
    text-align: center;
    margin-bottom: 48px;
    position: relative;
    z-index: 1;
    border-bottom: 4px solid #000;
    padding-bottom: 24px;
  }

  .title {
    font-size: 80px;
    font-weight: 900;
    color: #000;
    margin-bottom: 16px;
    text-shadow: 6px 6px 0 #FF69B4;
    letter-spacing: 4px;
  }

  .subtitle {
    font-size: 32px;
    color: #000;
    font-weight: 700;
    background: #FFD700;
    display: inline-block;
    padding: 8px 24px;
    border: 3px solid #000;
    box-shadow: 6px 6px 0 #000;
    transform: rotate(-2deg);
  }

  .stats-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 48px;
    gap: 24px;
    position: relative;
    z-index: 1;
  }

  .stat-item {
    text-align: center;
    flex: 1;
    padding: 32px 16px;
    border: 4px solid #000;
    box-shadow: 12px 12px 0 #000;
    position: relative;
    overflow: hidden;
  }

  .bg-yellow { background: #FFD700; }
  .bg-pink { background: #FF69B4; }
  .bg-cyan { background: #00CED1; }

  .stat-value {
    font-size: 72px;
    font-weight: 900;
    color: #000;
    line-height: 1;
    position: relative;
    z-index: 2;
  }

  .stat-label {
    font-size: 24px;
    color: #000;
    margin-top: 8px;
    font-weight: 700;
    text-transform: uppercase;
    position: relative;
    z-index: 2;
  }

  .trips-section {
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
  }

  .section-title {
    font-size: 36px;
    font-weight: 900;
    color: #000;
    margin-bottom: 24px;
    padding: 12px 24px;
    border: 4px solid #000;
    display: inline-block;
    background: #fff;
    box-shadow: 8px 8px 0 #000;
  }

  .trips-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .trip-item {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 20px 24px;
    background: #fff;
    border: 3px solid #000;
    box-shadow: 8px 8px 0 #000;
    transition: transform 0.2s;
    position: relative;
    overflow: hidden;
  }

  .trip-item:nth-child(odd) {
    transform: rotate(0.5deg);
  }

  .trip-item:nth-child(even) {
    transform: rotate(-0.5deg);
  }

  .trip-index {
    width: 48px;
    height: 48px;
    background: #000;
    color: #fff;
    border-radius: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 700;
    flex-shrink: 0;
    box-shadow: 4px 4px 0 #FF69B4;
    position: relative;
    z-index: 2;
  }

  .trip-info {
    flex: 1;
    position: relative;
    z-index: 2;
  }

  .trip-location {
    font-size: 28px;
    font-weight: 800;
    color: #000;
    margin-bottom: 4px;
  }

  .trip-location-en {
    position: absolute;
    right: 120px;
    bottom: -10px;
    font-size: 16px;
    font-weight: 900;
    color: rgba(0,0,0,0.08);
    text-transform: uppercase;
    letter-spacing: 1px;
    pointer-events: none;
    white-space: nowrap;
    font-style: italic;
    z-index: 1;
  }

  .trip-country {
    font-size: 22px;
    color: #000;
    font-weight: 500;
    background: #eee;
    display: inline-block;
    padding: 2px 8px;
    border: 2px solid #000;
  }

  .trip-tz {
    font-size: 18px;
    font-weight: 700;
    color: #000;
    background: #FFD700;
    padding: 6px 12px;
    border: 2px solid #000;
    box-shadow: 3px 3px 0 #000;
    flex-shrink: 0;
  }

  .more-trips {
    text-align: center;
    padding: 20px;
    color: #000;
    font-size: 24px;
    font-weight: 700;
    background: #fff;
    border: 3px dashed #000;
    margin-top: 10px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 60px;
    padding-top: 32px;
    border-top: 6px solid #000;
    position: relative;
    z-index: 1;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-icon {
    font-size: 40px;
    background: #FF69B4;
    border: 3px solid #000;
    padding: 4px;
    line-height: 1;
    box-shadow: 4px 4px 0 #000;
  }

  .brand-name {
    font-size: 32px;
    font-weight: 900;
    text-transform: uppercase;
    color: #000;
    font-style: italic;
  }

  .generated-at {
    font-size: 20px;
    color: #000;
    font-weight: 600;
    background: #fff;
    padding: 4px 12px;
    border: 2px solid #000;
  }

  .empty-state {
    text-align: center;
    padding: 80px 40px;
    border: 4px dashed #000;
    background: #fff;
    margin: 40px 0;
  }

  .empty-icon {
    font-size: 80px;
    margin-bottom: 24px;
  }

  .empty-text {
    font-size: 32px;
    font-weight: 700;
    color: #000;
  }
</style>
</head>
<body>
  <div class="deco-shape-1"></div>
  <div class="deco-shape-2"></div>

  <div class="container">
    <div class="header">
      <div class="avatar-ring">
        <img class="avatar" src="${avatarUrl || 'https://ui-avatars.com/api/?name=U&background=667eea&color=fff'}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=667eea&color=fff'" />
      </div>
      <div class="user-info">
        <div class="username">${escapeHtml(username)}</div>
        <div class="period">${year}年${monthName} 总结</div>
      </div>
    </div>

    <div class="title-section">
      <div class="title">猪猪月报</div>
      <div class="subtitle">PIG MONTHLY SUMMARY</div>
    </div>

    ${totalTrips > 0 ? `
      ${statsHtml}

      <div class="trips-section">
        <div class="section-title">本月足迹 TRACKS</div>
        <div class="trips-list">
          ${tripsHtml}
          ${moreTripsHtml}
        </div>
      </div>
    ` : `
      <div class="empty-state">
        <div class="empty-icon"><span class="twemoji">🐷</span></div>
        <div class="empty-text">这个月还没有旅行记录哦~</div>
      </div>
    `}

    <div class="footer">
      <div class="brand">
        <div class="brand-icon"><span class="twemoji">🐷</span></div>
        <div class="brand-name">Pig Travel</div>
      </div>
      <div class="generated-at">${new Date().toLocaleDateString('zh-CN')}</div>
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
    const tripHeight = Math.min(logs.length, 12) * 90
    const extraHeight = logs.length > 12 ? 60 : 0
    const totalHeight = baseHeight + tripHeight + extraHeight + (logs.length === 0 ? 200 : 0)

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
 * 准备月度总结数据
 */
export async function prepareMonthlySummary(
  ctx: Context,
  userId: string,
  platform: string,
  username: string,
  avatarUrl: string,
  year: number,
  month: number
): Promise<MonthlySummaryData> {
  const logs = await getMonthlyLogs(ctx, userId, platform, year, month)

  const countriesSet = new Set<string>()
  const locationsSet = new Set<string>()

  for (const log of logs) {
    countriesSet.add(log.country)
    locationsSet.add(log.location)
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
    locationsVisited: Array.from(locationsSet)
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
