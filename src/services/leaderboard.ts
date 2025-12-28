import { Context } from 'koishi'
import { Config } from '../config'
import { PigTravelLog, PigUserState } from '../database'

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
  abnormalCount: number
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

  // 过滤出有异常记录的用户并排序
  const entries: SleepLeaderboardEntry[] = states
    .filter(s => (s.abnormalCount ?? 0) > 0)
    .map(s => ({
      userId: s.userId,
      username: s.userId, // 稍后填充
      avatarUrl: '',      // 稍后填充
      abnormalCount: s.abnormalCount ?? 0,
    }))
    .sort((a, b) => b.abnormalCount - a.abnormalCount)

  return entries.slice(0, limit)
}

/**
 * 生成猪排行榜卡片
 */
export async function generatePigLeaderboardCard(
  ctx: Context,
  config: Config,
  entries: PigLeaderboardEntry[],
  guildId: string
): Promise<{ buffer: Buffer; filename: string }> {
  const rankItemsHtml = entries.map((entry, index) => {
    const rank = index + 1
    const medalClass = rank <= 3 ? `medal-${rank}` : ''
    const rankDisplay = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank.toString()

    return `
      <div class="rank-item ${medalClass}">
        <div class="rank-number">${rankDisplay}</div>
        <div class="avatar-container">
          <img class="avatar" src="${entry.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.username.charAt(0))}&background=667eea&color=fff`}"
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=667eea&color=fff'" />
        </div>
        <div class="user-info">
          <div class="username">${escapeHtml(entry.username)}</div>
          <div class="stats">
            <span class="stat-badge bg-yellow">${entry.tripCount} 次旅行</span>
            <span class="stat-badge bg-cyan">${entry.countryCount} 个国家</span>
          </div>
        </div>
        <div class="score">${entry.score}</div>
      </div>
    `
  }).join('')

  const html = generateLeaderboardHtml({
    title: '猪排行榜',
    subtitle: 'PIG TRAVEL RANKING',
    icon: '🐷',
    accentColor: '#FF69B4',
    rankItemsHtml,
    isEmpty: entries.length === 0,
    emptyText: '本群还没有旅行记录哦~',
    scoreLabel: '得分',
  })

  return await renderLeaderboardCard(ctx, config, html, `pig_rank_${guildId}`)
}

/**
 * 生成作息排行榜卡片
 */
export async function generateSleepLeaderboardCard(
  ctx: Context,
  config: Config,
  entries: SleepLeaderboardEntry[],
  guildId: string
): Promise<{ buffer: Buffer; filename: string }> {
  const rankItemsHtml = entries.map((entry, index) => {
    const rank = index + 1
    const medalClass = rank <= 3 ? `medal-${rank}` : ''
    const rankDisplay = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank.toString()

    return `
      <div class="rank-item ${medalClass}">
        <div class="rank-number">${rankDisplay}</div>
        <div class="avatar-container">
          <img class="avatar" src="${entry.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.username.charAt(0))}&background=667eea&color=fff`}"
               onerror="this.src='https://ui-avatars.com/api/?name=U&background=667eea&color=fff'" />
        </div>
        <div class="user-info">
          <div class="username">${escapeHtml(entry.username)}</div>
          <div class="stats">
            <span class="stat-badge bg-purple">熬夜达人</span>
          </div>
        </div>
        <div class="score">${entry.abnormalCount}</div>
      </div>
    `
  }).join('')

  const html = generateLeaderboardHtml({
    title: '熬夜王榜',
    subtitle: 'NIGHT OWL RANKING',
    icon: '🦉',
    accentColor: '#9B59B6',
    rankItemsHtml,
    isEmpty: entries.length === 0,
    emptyText: '本群还没有熬夜记录哦~',
    scoreLabel: '次数',
  })

  return await renderLeaderboardCard(ctx, config, html, `sleep_rank_${guildId}`)
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
}

function generateLeaderboardHtml(options: LeaderboardHtmlOptions): string {
  const { title, subtitle, icon, accentColor, rankItemsHtml, isEmpty, emptyText, scoreLabel } = options

  return `
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
    width: 800px;
    min-height: 600px;
    font-family: "Noto Sans SC", sans-serif, "Noto Color Emoji";
    background-color: #FFDEE9;
    background-image:
      radial-gradient(#000 10%, transparent 11%),
      radial-gradient(#000 10%, transparent 11%);
    background-size: 30px 30px;
    background-position: 0 0, 15px 15px;
    padding: 40px;
  }

  .twemoji {
    font-family: "Twemoji", "Noto Color Emoji", sans-serif;
  }

  .container {
    background: #fff;
    border: 4px solid #000;
    box-shadow: 16px 16px 0 #000;
    padding: 40px;
    position: relative;
    overflow: hidden;
  }

  .deco-shape-1 {
    position: absolute;
    top: -30px;
    right: -30px;
    width: 120px;
    height: 120px;
    background: ${accentColor};
    border: 4px solid #000;
    border-radius: 50%;
    z-index: 0;
  }

  .deco-shape-2 {
    position: absolute;
    bottom: 30px;
    left: -20px;
    width: 80px;
    height: 80px;
    background: #00CED1;
    border: 4px solid #000;
    transform: rotate(45deg);
    z-index: 0;
  }

  .header {
    text-align: center;
    margin-bottom: 32px;
    position: relative;
    z-index: 1;
    border-bottom: 4px solid #000;
    padding-bottom: 24px;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-bottom: 12px;
  }

  .title-icon {
    font-size: 56px;
    background: ${accentColor};
    border: 4px solid #000;
    padding: 8px 12px;
    box-shadow: 6px 6px 0 #000;
    line-height: 1;
  }

  .title {
    font-size: 56px;
    font-weight: 900;
    color: #000;
    text-shadow: 4px 4px 0 ${accentColor};
    letter-spacing: 4px;
  }

  .subtitle {
    font-size: 24px;
    color: #000;
    font-weight: 700;
    background: #FFD700;
    display: inline-block;
    padding: 6px 20px;
    border: 3px solid #000;
    box-shadow: 4px 4px 0 #000;
    transform: rotate(-1deg);
  }

  .rank-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
    z-index: 1;
  }

  .rank-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    background: #fff;
    border: 3px solid #000;
    box-shadow: 6px 6px 0 #000;
    position: relative;
    transition: transform 0.2s;
  }

  .rank-item:nth-child(odd) {
    transform: rotate(0.3deg);
  }

  .rank-item:nth-child(even) {
    transform: rotate(-0.3deg);
  }

  .rank-item.medal-1 {
    background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
  }

  .rank-item.medal-2 {
    background: linear-gradient(135deg, #C0C0C0 0%, #A0A0A0 100%);
  }

  .rank-item.medal-3 {
    background: linear-gradient(135deg, #CD7F32 0%, #8B4513 100%);
  }

  .rank-number {
    width: 48px;
    height: 48px;
    background: #000;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 900;
    flex-shrink: 0;
    box-shadow: 3px 3px 0 ${accentColor};
  }

  .medal-1 .rank-number,
  .medal-2 .rank-number,
  .medal-3 .rank-number {
    background: transparent;
    color: #000;
    font-size: 32px;
    box-shadow: none;
  }

  .avatar-container {
    border: 3px solid #000;
    border-radius: 50%;
    overflow: hidden;
    background: ${accentColor};
    flex-shrink: 0;
  }

  .avatar {
    width: 56px;
    height: 56px;
    object-fit: cover;
    display: block;
  }

  .user-info {
    flex: 1;
    min-width: 0;
  }

  .username {
    font-size: 24px;
    font-weight: 800;
    color: #000;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stats {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .stat-badge {
    font-size: 14px;
    font-weight: 600;
    padding: 2px 8px;
    border: 2px solid #000;
    display: inline-block;
  }

  .bg-yellow { background: #FFD700; }
  .bg-cyan { background: #00CED1; }
  .bg-pink { background: #FF69B4; }
  .bg-purple { background: #9B59B6; color: #fff; }

  .score {
    font-size: 32px;
    font-weight: 900;
    color: #000;
    background: #FFD700;
    padding: 8px 16px;
    border: 3px solid #000;
    box-shadow: 4px 4px 0 #000;
    flex-shrink: 0;
  }

  .score-label {
    position: absolute;
    top: -10px;
    right: 80px;
    font-size: 12px;
    font-weight: 700;
    background: #fff;
    padding: 2px 6px;
    border: 2px solid #000;
  }

  .empty-state {
    text-align: center;
    padding: 60px 40px;
    border: 4px dashed #000;
    background: #fff;
    margin: 20px 0;
  }

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
  }

  .empty-text {
    font-size: 24px;
    font-weight: 700;
    color: #000;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 32px;
    padding-top: 20px;
    border-top: 4px solid #000;
    position: relative;
    z-index: 1;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-icon {
    font-size: 32px;
    background: ${accentColor};
    border: 3px solid #000;
    padding: 4px;
    line-height: 1;
    box-shadow: 3px 3px 0 #000;
  }

  .brand-name {
    font-size: 24px;
    font-weight: 900;
    text-transform: uppercase;
    color: #000;
    font-style: italic;
  }

  .generated-at {
    font-size: 16px;
    color: #000;
    font-weight: 600;
    background: #fff;
    padding: 4px 10px;
    border: 2px solid #000;
  }
</style>
</head>
<body>
  <div class="deco-shape-1"></div>
  <div class="deco-shape-2"></div>

  <div class="container">
    <div class="header">
      <div class="title-row">
        <div class="title-icon"><span class="twemoji">${icon}</span></div>
        <div class="title">${title}</div>
      </div>
      <div class="subtitle">${subtitle}</div>
    </div>

    ${isEmpty ? `
      <div class="empty-state">
        <div class="empty-icon"><span class="twemoji">${icon}</span></div>
        <div class="empty-text">${emptyText}</div>
      </div>
    ` : `
      <div class="rank-list">
        ${rankItemsHtml}
      </div>
    `}

    <div class="footer">
      <div class="brand">
        <div class="brand-icon"><span class="twemoji">${icon}</span></div>
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
}

async function renderLeaderboardCard(
  ctx: Context,
  config: Config,
  html: string,
  filenamePrefix: string
): Promise<{ buffer: Buffer; filename: string }> {
  let page: Awaited<ReturnType<Context['puppeteer']['page']>> | null = null
  try {
    page = await ctx.puppeteer.page()

    if (config.debug) {
      page.on('console', msg => ctx.logger('pig').debug(`[Leaderboard] ${msg.text()}`))
    }

    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 1 })
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
