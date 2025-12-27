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
  logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

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
  const { year, month, logs, username, avatarUrl, totalTrips, countriesVisited, locationsVisited } = data

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
          <div class="trip-location">${escapeHtml(log.location)}</div>
          <div class="trip-country">${escapeHtml(log.country)} · ${dayStr}</div>
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
      <div class="stat-item">
        <div class="stat-value">${totalTrips}</div>
        <div class="stat-label">次旅行</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${countriesVisited.length}</div>
        <div class="stat-label">个国家</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${locationsVisited.length}</div>
        <div class="stat-label">个地点</div>
      </div>
    </div>
  `

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    width: 1080px;
    min-height: 1920px;
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif, "Noto Color Emoji";
    background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
    padding: 60px;
  }

  .twemoji {
    font-family: "Twemoji", "Noto Color Emoji", sans-serif;
  }

  .container {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 48px;
    padding: 60px;
    box-shadow: 0 40px 80px rgba(0,0,0,0.3);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 32px;
    margin-bottom: 48px;
  }

  .avatar-ring {
    padding: 6px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 50%;
  }

  .avatar {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    object-fit: cover;
    border: 4px solid white;
  }

  .user-info {
    flex: 1;
  }

  .username {
    font-size: 48px;
    font-weight: 800;
    color: #1d1d1f;
    margin-bottom: 8px;
  }

  .period {
    font-size: 28px;
    color: #666;
    font-weight: 500;
  }

  .title-section {
    text-align: center;
    margin-bottom: 48px;
  }

  .title {
    font-size: 64px;
    font-weight: 900;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 16px;
  }

  .subtitle {
    font-size: 32px;
    color: #888;
    font-weight: 500;
  }

  .stats-grid {
    display: flex;
    justify-content: space-around;
    margin-bottom: 48px;
    padding: 40px 0;
    background: linear-gradient(135deg, rgba(102,126,234,0.1), rgba(118,75,162,0.1));
    border-radius: 32px;
  }

  .stat-item {
    text-align: center;
  }

  .stat-value {
    font-size: 72px;
    font-weight: 900;
    color: #667eea;
    line-height: 1;
  }

  .stat-label {
    font-size: 24px;
    color: #666;
    margin-top: 8px;
    font-weight: 500;
  }

  .trips-section {
    margin-bottom: 32px;
  }

  .section-title {
    font-size: 32px;
    font-weight: 700;
    color: #1d1d1f;
    margin-bottom: 24px;
    padding-left: 16px;
    border-left: 6px solid #667eea;
  }

  .trips-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .trip-item {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 20px 24px;
    background: #f8f9fa;
    border-radius: 20px;
    transition: transform 0.2s;
  }

  .trip-index {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .trip-info {
    flex: 1;
  }

  .trip-location {
    font-size: 28px;
    font-weight: 700;
    color: #1d1d1f;
    margin-bottom: 4px;
  }

  .trip-country {
    font-size: 22px;
    color: #888;
  }

  .trip-tz {
    font-size: 18px;
    font-weight: 600;
    color: #667eea;
    background: rgba(102, 126, 234, 0.1);
    padding: 6px 12px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .more-trips {
    text-align: center;
    padding: 20px;
    color: #888;
    font-size: 24px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 40px;
    padding-top: 32px;
    border-top: 2px solid #eee;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    opacity: 0.6;
  }

  .brand-icon {
    font-size: 40px;
  }

  .brand-name {
    font-size: 24px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #1d1d1f;
  }

  .generated-at {
    font-size: 20px;
    color: #888;
  }

  .empty-state {
    text-align: center;
    padding: 80px 40px;
    color: #888;
  }

  .empty-icon {
    font-size: 80px;
    margin-bottom: 24px;
  }

  .empty-text {
    font-size: 32px;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="avatar-ring">
        <img class="avatar" src="${avatarUrl || 'https://ui-avatars.com/api/?name=U&background=667eea&color=fff'}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=667eea&color=fff'" />
      </div>
      <div class="user-info">
        <div class="username">${escapeHtml(username)}</div>
        <div class="period">${year}年${monthName} 旅行总结</div>
      </div>
    </div>

    <div class="title-section">
      <div class="title"><span class="twemoji">🐷</span> 猪醒月报</div>
      <div class="subtitle">Monthly Travel Summary</div>
    </div>

    ${totalTrips > 0 ? `
      ${statsHtml}

      <div class="trips-section">
        <div class="section-title">足迹记录</div>
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
      <div class="generated-at">生成于 ${new Date().toLocaleDateString('zh-CN')}</div>
    </div>
  </div>

  <script>
    window.renderReady = document.fonts.ready.then(() => new Promise(r => setTimeout(r, 100)));
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
