import { Context } from 'koishi'
import { promises as fs } from 'fs'
import { Config } from '../config'
import { PigTravelLog, PigUserState } from '../database'
import { getPigSvgDataUrlByName, getRandomPigSvgDataUrl } from './pig-icon'

export interface PigLeaderboardEntry {
  userId: string
  username: string
  avatarUrl: string
  tripCount: number
  countryCount: number
  score: number  // 综合得分 = tripCount + countryCount * 2
}

export interface SleepLeaderboardEntry {
  userId: string
  username: string
  avatarUrl: string
  nightOwlCount: number
  totalMessageCount: number
  nightMessageCount: number
  peakHour: number  // 最活跃的小时
}

export interface LeaderboardData {
  guildId: string
  platform: string
  entries: PigLeaderboardEntry[] | SleepLeaderboardEntry[]
  currentUserId?: string
  currentUserRank?: number
}

/**
 * 获取群组内猪排行榜数据
 */
export async function getPigLeaderboard(
  ctx: Context,
  guildId: string,
  platform: string,
  limit: number = 10
): Promise<PigLeaderboardEntry[]> {
  // 获取该群组的所有旅行记录
  const logs = await ctx.database.get('pig_travel_log', {
    guildId,
    platform,
  })

  if (logs.length === 0) {
    return []
  }

  // 按用户统计
  const userStats = new Map<string, { tripCount: number; countries: Set<string> }>()

  for (const log of logs) {
    if (!userStats.has(log.userId)) {
      userStats.set(log.userId, { tripCount: 0, countries: new Set() })
    }
    const stat = userStats.get(log.userId)!
    stat.tripCount++
    stat.countries.add(log.country)
  }

  // 转换为排行榜条目
  const entries: PigLeaderboardEntry[] = []
  for (const [userId, stat] of userStats) {
    const countryCount = stat.countries.size
    entries.push({
      userId,
      username: userId, // 稍后填充
      avatarUrl: '',    // 稍后填充
      tripCount: stat.tripCount,
      countryCount,
      score: stat.tripCount + countryCount * 2, // 综合得分
    })
  }

  // 按得分排序
  entries.sort((a, b) => b.score - a.score)

  // 返回前 N 名
  return entries.slice(0, limit)
}

/**
 * 获取群组内作息排行榜数据
 */
export async function getSleepLeaderboard(
  ctx: Context,
  guildId: string,
  platform: string,
  limit: number = 10
): Promise<SleepLeaderboardEntry[]> {
  // 获取该群组的所有用户状态
  const states = await ctx.database.get('pig_user_state', {
    guildId,
    platform,
  })

  if (states.length === 0) {
    return []
  }

  // 过滤出有熬夜记录的用户并排序
  const entries: SleepLeaderboardEntry[] = states
    .filter(s => (s.nightOwlCount ?? 0) > 0)
    .map(s => {
      // 解析小时统计找出最活跃时段
      let peakHour = 0
      let maxCount = 0
      try {
        const hourlyCounts = s.hourlyMessageCounts ? JSON.parse(s.hourlyMessageCounts) : {}
        for (const [hour, count] of Object.entries(hourlyCounts)) {
          if ((count as number) > maxCount) {
            maxCount = count as number
            peakHour = parseInt(hour)
          }
        }
      } catch {
        peakHour = 0
      }

      return {
        userId: s.userId,
        username: s.userId, // 稍后填充
        avatarUrl: '',      // 稍后填充
        nightOwlCount: s.nightOwlCount ?? 0,
        totalMessageCount: s.totalMessageCount ?? 0,
        nightMessageCount: s.nightMessageCount ?? 0,
        peakHour,
      }
    })
    .sort((a, b) => b.nightOwlCount - a.nightOwlCount)

  return entries.slice(0, limit)
}

/**
 * 生成猪排行榜卡片
 */
export async function generatePigLeaderboardCard(
  ctx: Context,
  config: Config,
  entries: PigLeaderboardEntry[],
  guildId: string,
  backgroundImage?: string
): Promise<{ buffer: Buffer; filename: string }> {
  // 默认占位符背景
  const defaultBgUrl = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073&auto=format&fit=crop'

  // 处理背景图片：如果是本地文件，转换为 base64
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
        if (config.debug) ctx.logger('pig').debug(`Loaded local background for pig rank: ${filePath}`)
      } catch (e) {
        ctx.logger('pig').warn(`Failed to load local background: ${e}`)
      }
    } else {
      bgUrl = backgroundImage
    }
  }

  const rankItemsHtml = entries.map((entry, index) => {
    const rank = index + 1
    const rankDisplay = rank.toString().padStart(2, '0')

    // Spot colors for top 3
    let rankColorClass = ''
    if (rank === 1) rankColorClass = 'highlight-yellow'
    else if (rank === 2) rankColorClass = 'highlight-pink'
    else if (rank === 3) rankColorClass = 'highlight-blue'

    return `
      <div class="rank-item">
        <div class="rank-number ${rankColorClass}">${rankDisplay}</div>
        <div class="avatar-container">
          <img class="avatar" src="${entry.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.username.charAt(0))}&background=333&color=fff`}"
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=333&color=fff'" />
        </div>
        <div class="user-info">
          <div class="username">${escapeHtml(entry.username)}</div>
          <div class="stats">
            <span class="stat-main">${entry.tripCount} TRIPS</span>
            <span class="stat-sub">/ ${entry.countryCount} COUNTRIES</span>
          </div>
        </div>
        <div class="score-box">
          <div class="score-label">SCORE</div>
          <div class="score-value">${entry.score}</div>
        </div>
      </div>
    `
  }).join('')

  const pigSvg = await getRandomPigSvgDataUrl()
  const pigIcon = pigSvg
    ? `<img class="header-icon-img" src="${pigSvg}" alt="pig" />`
    : '🐷'

  const html = generateLeaderboardHtml({
    title: 'TRAVELER',
    subtitle: 'RANKING LIST',
    icon: pigIcon,
    accentColor: '#1A1A1A',
    rankItemsHtml,
    isEmpty: entries.length === 0,
    emptyText: 'NO TRAVEL RECORDS YET',
    scoreLabel: 'PTS',
    bgText: 'TRAVEL',
    avatarGrayscale: false, // Always color for travel
    bgUrl
  })

  return await renderLeaderboardCard(ctx, config, html, `pig_rank_${guildId}`, entries.length)
}

/**
 * 生成作息排行榜卡片
 */
export async function generateSleepLeaderboardCard(
  ctx: Context,
  config: Config,
  entries: SleepLeaderboardEntry[],
  guildId: string,
  backgroundImage?: string
): Promise<{ buffer: Buffer; filename: string }> {
  // 默认占位符背景
  const defaultBgUrl = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2073&auto=format&fit=crop'

  // 处理背景图片：如果是本地文件，转换为 base64
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
        if (config.debug) ctx.logger('pig').debug(`Loaded local background for sleep rank: ${filePath}`)
      } catch (e) {
        ctx.logger('pig').warn(`Failed to load local background: ${e}`)
      }
    } else {
      bgUrl = backgroundImage
    }
  }

  const rankItemsHtml = entries.map((entry, index) => {
    const rank = index + 1
    const rankDisplay = rank.toString().padStart(2, '0')
    const peakHourStr = `${entry.peakHour.toString().padStart(2, '0')}:00`

    // Spot colors for top 3
    let rankColorClass = ''
    if (rank === 1) rankColorClass = 'highlight-yellow'
    else if (rank === 2) rankColorClass = 'highlight-pink'
    else if (rank === 3) rankColorClass = 'highlight-blue'

    return `
      <div class="rank-item">
        <div class="rank-number ${rankColorClass}">${rankDisplay}</div>
        <div class="avatar-container">
          <img class="avatar" src="${entry.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.username.charAt(0))}&background=333&color=fff`}"
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=333&color=fff'" />
        </div>
        <div class="user-info">
          <div class="username">${escapeHtml(entry.username)}</div>
          <div class="stats">
            <span class="stat-main">${entry.nightMessageCount} NIGHT MSGS</span>
            <span class="stat-sub">PEAK: ${peakHourStr}</span>
          </div>
        </div>
        <div class="score-box">
          <div class="score-label">OWL PTS</div>
          <div class="score-value">${entry.nightOwlCount}</div>
        </div>
      </div>
    `
  }).join('')

  const owlSvg = await getPigSvgDataUrlByName('owl.svg')
  const owlIcon = owlSvg
    ? `<img class="header-icon-img" src="${owlSvg}" alt="owl" />`
    : '🦉'

  const html = generateLeaderboardHtml({
    title: 'NIGHT OWL',
    subtitle: 'ACTIVE AT NIGHT',
    icon: owlIcon,
    accentColor: '#1A1A1A',
    rankItemsHtml,
    isEmpty: entries.length === 0,
    emptyText: 'NO NIGHT OWLS FOUND',
    scoreLabel: 'TIMES',
    bgText: 'INSOMNIA',
    avatarGrayscale: config.nightOwlGrayscaleAvatar, // Use config
    bgUrl
  })

  return await renderLeaderboardCard(ctx, config, html, `sleep_rank_${guildId}`, entries.length)
}

interface LeaderboardHtmlOptions {
  title: string
  subtitle: string
  icon: string
  accentColor: string
  rankItemsHtml: string
  isEmpty: boolean
  emptyText: string
  scoreLabel: string
  bgText: string
  avatarGrayscale: boolean
  bgUrl: string
}

function generateLeaderboardHtml(options: LeaderboardHtmlOptions): string {
  const { title, subtitle, icon, accentColor, rankItemsHtml, isEmpty, emptyText, scoreLabel, bgText, avatarGrayscale, bgUrl } = options

  return `
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
    width: 800px;
    font-family: "Noto Sans SC", sans-serif;
    background-color: #F7F5F2; /* 纸张米色 */
    color: #1A1A1A;
    padding: 0;
  }

  .container {
    padding: 60px;
    display: flex;
    flex-direction: column;
    position: relative;
    background: #F7F5F2; /* 默认纸张米色，会被自定义背景覆盖 */
    overflow: hidden;
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
    filter: grayscale(100%); /* 默认黑白 */
    pointer-events: none;
  }

  /* 装饰背景字 */
  .bg-text {
    position: absolute;
    top: 100px;
    right: -20px;
    font-size: 180px;
    font-weight: 900;
    color: rgba(0,0,0,0.03);
    z-index: 1;
    pointer-events: none;
    font-family: "Noto Serif SC", serif;
    letter-spacing: 20px;
    word-break: break-all;
    line-height: 0.8;
    width: 100%;
    text-align: right;
  }

  /* 顶部 Header */
  .header {
    border-bottom: 4px solid #1A1A1A;
    padding-bottom: 20px;
    margin-bottom: 40px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    position: relative;
    z-index: 2;
  }

  .header-left {
    display: flex;
    flex-direction: column;
  }

  .main-title {
    font-family: "Noto Serif SC", serif;
    font-size: 80px;
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -3px;
    color: #1A1A1A;
  }

  .sub-title {
    font-size: 20px;
    text-transform: uppercase;
    letter-spacing: 6px;
    margin-top: 10px;
    font-weight: 700;
    color: #666;
  }

  .header-icon {
    font-size: 80px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .header-icon-img {
    width: 88px;
    height: 88px;
    object-fit: contain;
    display: block;
  }

  /* 列表样式 */
  .rank-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    z-index: 2;
  }

  .rank-item {
    display: grid;
    grid-template-columns: 80px 70px 1fr 100px;
    gap: 20px;
    padding: 24px 0;
    border-bottom: 1px dashed #ccc;
    align-items: center;
  }

  .rank-item:first-child {
    padding-top: 10px;
    border-bottom: 2px solid #1A1A1A;
  }

  /* 只有第一名的头像放大 */
  .rank-item:first-child .avatar-container {
    width: 90px;
    height: 90px;
  }

  .rank-number {
    font-family: "Noto Serif SC", serif;
    font-size: 48px;
    font-weight: 700;
    color: #ccc;
    font-style: italic;
    text-align: center;
  }

  /* Spot Colors */
  .rank-number.highlight-yellow { color: #E6B422; /* Gold-ish */ }
  .rank-number.highlight-pink { color: #FF9AA2; }
  .rank-number.highlight-blue { color: #A0C4FF; }

  .avatar-container {
    width: 70px;
    height: 70px;
    border: 1px solid #1A1A1A;
    padding: 4px;
    background: #fff;
    transform: rotate(-3deg);
    box-shadow: 3px 3px 0 rgba(0,0,0,0.1);
  }

  .avatar {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: ${avatarGrayscale ? 'grayscale(100%) contrast(1.1)' : 'none'};
  }

  .user-info {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .username {
    font-family: "Noto Serif SC", serif;
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 4px;
    color: #1A1A1A;
  }

  .stats {
    font-size: 14px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-family: "Noto Sans SC", sans-serif;
  }

  .stat-main {
    font-weight: 700;
    color: #1A1A1A;
    background: #E0D8D0;
    padding: 2px 6px;
    border-radius: 2px;
  }

  .score-box {
    text-align: right;
  }

  .score-value {
    font-family: "Noto Serif SC", serif;
    font-size: 40px;
    font-weight: 900;
    line-height: 1;
  }

  .score-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #888;
  }

  /* 空状态 */
  .empty-state {
    text-align: center;
    padding: 100px 0;
    color: #888;
    z-index: 2;
  }

  .empty-text {
    font-family: "Noto Serif SC", serif;
    font-size: 24px;
    font-style: italic;
  }

  /* 底部 */
  .footer {
    margin-top: 40px;
    padding-top: 40px;
    border-top: 1px solid #1A1A1A;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 2px;
    z-index: 2;
  }

  .footer-brand {
    font-weight: 700;
    color: #1A1A1A;
    font-family: "Noto Serif SC", serif;
  }
</style>
</head>
<body>
  <div class="container">
    <div class="custom-bg"></div>
    <div class="bg-text">${bgText}</div>

    <div class="header">
      <div class="header-left">
        <div class=\"main-title\">${title}</div>
        <div class="sub-title">${subtitle}</div>
      </div>
      <div class="header-icon">${icon}</div>
    </div>

    ${isEmpty ? `
      <div class="empty-state">
        <div class="empty-text">${emptyText}</div>
      </div>
    ` : `
      <div class="rank-list">
        ${rankItemsHtml}
      </div>
    `}

    <div class="footer">
      <div class="footer-brand">PIG TRAVEL</div>
      <div>${new Date().toLocaleDateString('en-US').toUpperCase()}</div>
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
}

async function renderLeaderboardCard(
  ctx: Context,
  config: Config,
  html: string,
  filenamePrefix: string,
  entryCount: number
): Promise<{ buffer: Buffer; filename: string }> {
  let page: Awaited<ReturnType<Context['puppeteer']['page']>> | null = null
  try {
    page = await ctx.puppeteer.page()

    if (config.debug) {
      page.on('console', msg => ctx.logger('pig').debug(`[Leaderboard] ${msg.text()}`))
    }

    // 动态计算高度：头部约200px + 每条约120px + 底部约150px
    const baseHeight = 350
    const entryHeight = Math.max(entryCount, 1) * 120
    const totalHeight = baseHeight + entryHeight

    await page.setViewport({ width: 800, height: totalHeight, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => window['renderReady'])

    const buffer = await page.screenshot({ type: 'png', fullPage: true }) as Buffer
    const filename = `${filenamePrefix}_${Date.now()}.png`

    ctx.logger('pig').info(`排行榜卡片已生成: ${filename}`)
    return { buffer, filename }
  } catch (e) {
    ctx.logger('pig').error('Failed to generate leaderboard card', e)
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
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
