import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { Location } from '../constants'
import { Config } from '../config'
import { UserInfo } from './travel'
import { getPigSvgDataUrlByName, getPigSvgDirResolved, getRandomPigSvgDataUrl } from './pig-icon'

export interface CardData {
  location: Location
  msg: string
}

export interface CardResult {
  buffer: Buffer
  filename: string
}

import { LOCATIONS } from '../constants'

export async function generateFootprintCard(
  ctx: Context,
  config: Config,
  data: CardData,
  userInfo: UserInfo,
  platform: string,
  backgroundUrl: string | null
): Promise<CardResult> {
  const username = userInfo.username || userInfo.userId
  let avatarUrl = userInfo.avatarUrl || ''

  // Fallback avatar if empty - use platform-specific avatar API when possible
  if (!avatarUrl) {
    if (platform === 'onebot') {
      // QQ platform: use QQ avatar API
      avatarUrl = `https://q.qlogo.cn/headimg_dl?dst_uin=${userInfo.userId}&spec=640`
    } else {
      // Other platforms: generate a nicer default with single character
      const initial = username.charAt(0) || 'U'
      avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=007AFF&color=fff&size=200&bold=true`
    }
  }

  // Use provided background or fallback
  let bgImage = backgroundUrl || data.location.landscapeUrl
  if (config.debug) ctx.logger('pig').debug(`Initial background URL: ${bgImage || 'none'}`)

  const normalizeImageUrl = (url: string) => {
    const trimmed = url.trim()
    if (trimmed.startsWith('data:')) return trimmed
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        return encodeURI(trimmed)
      } catch {
        return trimmed
      }
    }
    return trimmed
  }

  const sniffMime = (buffer: Buffer) => {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg'
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp'
    return 'image/jpeg'
  }

  const inlineMaxBytes = config.backgroundInlineMaxBytes ?? 2 * 1024 * 1024
  const fetchTimeoutMs = config.backgroundFetchTimeoutMs ?? 8000
  const shouldServerFetch = (url: string) => {
    const mode = config.backgroundFetchMode || 'auto'
    if (mode === 'never') return false
    if (mode === 'always') return true
    return !/^https?:\/\/(images|source)\.unsplash\.com\//i.test(url)
  }

  const fetchToDataUrl = async (url: string, options: { forceServerFetch?: boolean } = {}) => {
    const forceServerFetch = options.forceServerFetch ?? false
    const normalized = normalizeImageUrl(url)
    if (config.debug) ctx.logger('pig').debug(`Normalized background URL: ${normalized}`)
    if (normalized.startsWith('data:')) return normalized

    if (normalized.startsWith('file://')) {
      try {
        const filePath = fileURLToPath(normalized)
        const buffer = await readFile(filePath)
        const mime = sniffMime(buffer)
        if (buffer.length > inlineMaxBytes) {
          if (config.debug) ctx.logger('pig').warn(`Background too large for data URL (${buffer.length} bytes), using file URL`)
          return normalized
        }
        if (config.debug) ctx.logger('pig').debug(`Loaded local background file: ${filePath} (${mime}, ${buffer.length} bytes)`)
        return `data:${mime};base64,${buffer.toString('base64')}`
      } catch (e) {
        if (config.debug) ctx.logger('pig').warn(`Failed to read local background file: ${e}`)
        return null
      }
    }

    if (/^https?:\/\//i.test(normalized)) {
      if (!forceServerFetch && !shouldServerFetch(normalized)) {
        if (config.debug) {
          ctx.logger('pig').debug(`Skip server-side fetch for background: ${normalized}`)
        }
        return normalized
      }
      try {
        if (config.debug) ctx.logger('pig').debug(`Server-side fetching background: ${normalized}`)
        const response = await ctx.http(normalized, {
          responseType: 'arraybuffer',
          timeout: fetchTimeoutMs,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
        })
        // Koishi ctx.http with responseType: 'arraybuffer' may return either:
        // - A response object with .data property (when using full options)
        // - Raw ArrayBuffer (in some cases)
        // We need to handle both cases
        const rawData = (response as any)?.data ?? response
        const buffer = Buffer.from(rawData as ArrayBuffer)
        const mime = sniffMime(buffer)
        if (config.debug) {
          ctx.logger('pig').debug(
            `Background fetch response: url=${normalized} detected-mime=${mime} size=${buffer.length}`
          )
        }
        // Validate that we got a valid image by checking magic bytes
        if (mime === 'image/jpeg' && buffer[0] !== 0xFF) {
          if (config.debug) ctx.logger('pig').warn(`Background fetch returned invalid image data`)
          return null
        }
        if (buffer.length > inlineMaxBytes) {
          if (config.debug) ctx.logger('pig').warn(`Background too large for data URL (${buffer.length} bytes), using remote URL`)
          return normalized
        }
        if (config.debug) ctx.logger('pig').debug(`Background fetched and decoded: ${mime}, ${buffer.length} bytes`)
        return `data:${mime};base64,${buffer.toString('base64')}`
      } catch (e) {
        if (config.debug) ctx.logger('pig').warn(`Failed to fetch background server-side: ${e}`)
        return null
      }
    }

    return normalized
  }

  const avatarFetched = avatarUrl ? await fetchToDataUrl(avatarUrl, { forceServerFetch: true }) : null
  if (avatarFetched) {
    avatarUrl = avatarFetched
  }

  const fontSources = [
    {
      name: 'WDXL Lubrifont SC',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/wdxl-lubrifont-sc@latest/chinese-simplified-400-normal.woff2',
      format: 'woff2',
    },
    {
      name: 'Noto Serif SC',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-serif-sc@latest/chinese-simplified-400-normal.woff2',
      format: 'woff2',
    },
    {
      name: 'Bebas Neue',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/bebas-neue@latest/latin-400-normal.woff2',
      format: 'woff2',
    },
    {
      name: 'BBH Sans Bogle',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/bbh-sans-bogle@latest/latin-400-normal.woff2',
      format: 'woff2',
    },
    {
      name: 'BBH Sans Bartle',
      url: 'https://cdn.jsdelivr.net/fontsource/fonts/bbh-sans-bartle@latest/latin-400-normal.woff2',
      format: 'woff2',
    },
  ]

  let fontFaceCss = ''
  if (ctx.glyph) {
    for (const font of fontSources) {
      try {
        const ok = await ctx.glyph.checkFont(font.name, font.url)
        if (!ok) continue
        const dataUrl = ctx.glyph.getFontDataUrl(font.name)
        if (!dataUrl) continue
        const aliasName = font.name.replace('BBH Sans ', 'BBH ')
        fontFaceCss += `
  @font-face {
    font-family: "${font.name}";
    src: url("${dataUrl}") format("${font.format}");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  ${font.name.startsWith('BBH Sans ')
    ? `@font-face {
    font-family: "${aliasName}";
    src: url("${dataUrl}") format("${font.format}");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }`
    : ''}
`
      } catch (e) {
        if (config.debug) ctx.logger('pig').warn(`Glyph font load failed: ${font.name}`, e)
      }
    }
  }

  // Fallback gradient background when remote image fails to load
  const fallbackGradient = 'data:image/svg+xml,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#9ca3af;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#6b7280;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#4b5563;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
    </svg>
  `.trim())

  if (bgImage) {
    bgImage = normalizeImageUrl(bgImage)
    const fetched = await fetchToDataUrl(bgImage, { forceServerFetch: config.backgroundFetchMode === 'always' })
    if (fetched) {
      bgImage = fetched
      if (config.debug && fetched.startsWith('data:')) {
        ctx.logger('pig').debug(`Successfully converted background to base64 (length=${fetched.length})`)
      }
    } else {
      // Server-side fetch failed - use fallback gradient instead of broken remote URL
      // The remote URL would likely also fail in Puppeteer due to network issues
      if (config.debug) ctx.logger('pig').warn('Background fetch failed, using fallback gradient')
      bgImage = fallbackGradient
    }
    if (config.debug) {
      ctx.logger('pig').debug(`Final background value: ${bgImage ? (bgImage.startsWith('data:') ? `data-url(${bgImage.length})` : bgImage) : 'none'}`)
    }
  } else {
    // No background URL provided at all - use fallback gradient
    bgImage = fallbackGradient
  }

  // Format date in Chinese
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

  const bgCssValue = bgImage ? `url("${bgImage}")` : 'none'
  let pigSvg = await getRandomPigSvgDataUrl()
  if (!pigSvg) {
    pigSvg = await getPigSvgDataUrlByName('pig.svg')
  }
  if (!pigSvg && config.debug) {
    const svgDir = await getPigSvgDirResolved()
    ctx.logger('pig').warn(`Pig SVG not available, fallback emoji (dir=${svgDir ?? 'none'})`)
  }
  const pigInline = pigSvg
    ? `<img class="pig-emoji pig-emoji--inline" src="${pigSvg}" alt="pig" />`
    : '<span class="pig-emoji-fallback">🐷</span>'
  const pigBrand = pigSvg
    ? `<img class="pig-emoji pig-emoji--brand" src="${pigSvg}" alt="pig" />`
    : '<span class="pig-emoji-fallback">🐷</span>'
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${fontFaceCss}
  /* System fonts only - no external font loading for Docker compatibility */
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    width: 1080px;
    height: 1920px;
    overflow: hidden;
    /* Default emoji font set to Noto Color Emoji to maintain layout consistency */
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Micro Hei", "Droid Sans Fallback", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji";
    background: #f0f0f2;
    --bg-image: ${bgCssValue};
    --date-color: #D46A6A;
    --date-color-light: #E39A9A;
    --landmark-font: "BBH Bogle", "BBH Bartle", "BBH Sans Bogle", "BBH Sans Bartle", "FZLanTingHei-B-GBK", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    --body-font: "WDXL Lubrifont SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    --small-font: "BBH Bartle", "BBH Bogle", "BBH Sans Bartle", "BBH Sans Bogle", "FZLanTingHei-B-GBK", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  }

  .pig-emoji {
    display: inline-block;
    width: 1.1em;
    height: 1.1em;
    vertical-align: -0.12em;
    object-fit: contain;
  }

  .pig-emoji--brand {
    width: 56px;
    height: 56px;
  }

  .pig-emoji-fallback {
    font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
    vertical-align: -0.08em;
  }


  .wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f0f0f2;
  }

  /* Dynamic Background Image */
  .bg-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    background-color: #d1d1d6;
    z-index: 0;
  }

  /* Gradient Overlay for Depth */
  .bg-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0) 0%,
      rgba(0,0,0,0.1) 60%,
      rgba(0,0,0,0.4) 100%
    );
    z-index: 1;
  }

  .card-container {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    padding: 72px;
    padding-bottom: 72px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  /* Constructivism & Collage Liquid Glass Style */
  .glass-card {
    position: relative;
    border-radius: 64px; /* 液态感的大圆角 */
    padding: 40px 60px; /* 减少垂直内边距，使卡片变扁 */
    overflow: hidden;

    /* 极强的高斯模糊，让背景变成抽象色块 */
    backdrop-filter: blur(80px) saturate(180%) contrast(110%);
    -webkit-backdrop-filter: blur(80px) saturate(180%) contrast(110%);

    /* 玻璃基底：半透明白，带一点纸张的暖色倾向 - 莫奈 睡莲池的雾霭 */
    background: rgba(255, 252, 245, 0.65);

    /* 液态边缘光泽 - 莫奈 晨雾蓝 */
    border: 3px solid rgba(198, 216, 230, 0.6);
    box-shadow:
      0 40px 100px -20px rgba(78, 88, 110, 0.2), /* 深蓝灰阴影 */
      inset 0 0 40px rgba(255, 255, 255, 0.6),
      inset 0 0 0 6px rgba(198, 216, 230, 0.3);
  }

  /* 构成主义装饰：改为莫奈日出红橙色 */
  .deco-circle {
    position: absolute;
    top: -40px;
    right: -40px;
    width: 200px;
    height: 200px;
    background: #FF9B71; /* 莫奈日出 橙红 */
    border-radius: 50%;
    z-index: 0;
    mix-blend-mode: overlay; /* 更加柔和的混合 */
    opacity: 0.9;
    filter: blur(20px); /* 增加朦胧感 */
  }

  /* 装饰线条：改为莫奈 睡莲叶深绿 */
  .deco-line {
    position: absolute;
    bottom: 0;
    left: 120px;
    width: 8px;
    height: 100%;
    background: #4A6C56; /* 睡莲叶深绿 */
    z-index: 0;
    transform: rotate(15deg);
    opacity: 0.2;
  }

  /* 装饰色块：改为莫奈 紫罗兰 */
  .deco-block-red {
    position: absolute;
    bottom: -100px;
    right: -50px;
    width: 300px;
    height: 300px;
    background: #9B8BB1; /* 莫奈 紫罗兰 */
    transform: rotate(45deg);
    z-index: 0;
    opacity: 0.7;
    mix-blend-mode: multiply;
    filter: blur(40px); /* 油画笔触般的晕染 */
  }

  /* 装饰网格：改为莫奈 天光蓝 */
  .deco-dots {
    position: absolute;
    top: 20px;
    left: 20px;
    width: 100%;
    height: 100%;
    background-image: radial-gradient(#7FA8C4 2px, transparent 2px); /* 天光蓝 */
    background-size: 20px 20px;
    opacity: 0.15;
    z-index: 0;
    pointer-events: none;
  }

  /* 拼贴元素：胶带效果 - 保持半透明 */
  .tape-strip {
    position: absolute;
    top: -15px;
    left: 50%;
    transform: translateX(-50%) rotate(-2deg);
    width: 120px;
    height: 36px;
    background: rgba(255, 255, 255, 0.5);
    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    backdrop-filter: blur(5px);
    z-index: 10;
    border: 1px dashed rgba(74, 108, 86, 0.2); /* 绿色虚线 */
  }

  /* 拼贴元素：报纸剪切风格文字背景 - 改为深色文字背景 */
  .cutout-text-bg {
    background: #3E4E50; /* 深灰绿 */
    color: #f0f0f2;
    padding: 2px 8px;
    transform: skew(-10deg);
    display: inline-block;
  }


  /* 强力噪点纹理，增加拼贴纸质感 */
  .card-content::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.15'/%3E%3C/svg%3E");
    mix-blend-mode: overlay;
    pointer-events: none;
    z-index: -1;
  }

  /* Content Wrapper */
  .card-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 32px;
  }

  /* 头像：拼贴风格，带粗框 */
  .avatar-ring {
    position: relative;
    padding: 0;
    background: transparent;
    border-radius: 50%;
    /* 构成主义：错位阴影 - 改为深紫灰 */
    box-shadow: 8px 8px 0 #4E586E;
    border: 4px solid #4E586E;
    /* transform: rotate(-3deg); 移除旋转 */
  }

  .avatar {
    display: block;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    object-fit: cover;
    /* 拼贴风格：改为柔和对比度 */
    filter: contrast(1.05) sepia(0.2); /* 增加一点怀旧色调 */
  }

  .user-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center; /* 垂直居中对齐 */
  }

  .username {
    font-size: 48px;
    font-weight: 900;
    color: #4E586E; /* 莫奈深蓝灰 */
    letter-spacing: -0.02em;
    line-height: 1;
    text-transform: uppercase;
    /* 构成主义：文字背景块 */
    text-shadow: 2px 2px 0 rgba(255,255,255,0.6);
  }

  .date {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.05em;
    background: linear-gradient(90deg, var(--date-color), var(--date-color-light));
    padding: 4px 12px;
    width: fit-content;
    /* transform: rotate(1deg); 移除旋转 */
    box-shadow: 4px 4px 0 #4E586E; /* 深蓝灰阴影 */
    font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  }

  .message-body {
    padding: 10px 0;
    position: relative;
    padding-left: 20px; /* 整体左侧增加一点内边距，避免紧贴边缘 */
  }

  .message-text {
    font-size: 60px;
    line-height: 1.4; /* 增加行高 */
    font-weight: 900;
    color: #4E586E; /* 莫奈深蓝灰 */
    letter-spacing: -0.03em;
  }

  /* 高亮样式：黑白强调 */
  .highlight {
    color: #000000;
    background: #ffffff;
    padding: 8px 16px;
    border: 3px solid #000000;
    box-shadow: 6px 6px 0 #000000;
    border-radius: 0;
    display: inline-block;
    margin: 12px 0;
  }

  .divider {
    height: 4px;
    background: #4E586E;
    width: 100%;
    /* 虚线风格 */
    background-image: linear-gradient(to right, #4E586E 50%, transparent 50%);
    background-size: 20px 100%;
    opacity: 0.2;
    margin-left: 20px; /* 与 message-body 对齐 */
    width: calc(100% - 20px); /* 保持宽度正确 */
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .location-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: flex-start;
    padding-left: 20px; /* 与上方内容对齐 */
  }

  .location-pill {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: #4E586E; /* 莫奈深蓝灰 */
    padding: 12px 32px;
    border-radius: 100px;
    /* transform: rotate(1deg); 移除旋转 */
  }

  .location-pill span {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.05em;
    font-family: var(--small-font);
  }

  .landmark-name {
    font-size: 28px; /* 缩小字号 */
    font-weight: 900;
    color: #4E586E;
    letter-spacing: -0.02em;
    padding-left: 0; /* 移除左内边距，严格左对齐 */
    line-height: 1.2;
    /* 装饰性下划线 */
    border-bottom: 4px solid #D46A6A; /* 柔和红，稍微变细 */
    display: inline-block;
    transform: translate(-10px, 4px); /* 向左下偏移 */
  }

  .brand-tag {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    opacity: 1; /* 提高不透明度 */
  }

  .brand-icon {
    font-size: 50px;
    margin-bottom: 4px;
    /* 旋转 */
    transform: rotate(10deg);
  }

  .brand-name {
    font-size: 20px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: #4E586E;
    background: rgba(255, 255, 255, 0.8);
    padding: 2px 6px;
    border: 2px solid #4E586E;
  }

  /* Content Wrapper */
  .card-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 24px; /* 减少间距 */
  }

  .header {
    display: flex;
    align-items: center;
    gap: 24px;
  }

  .avatar-ring {
    padding: 6px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 8px 30px rgba(0,0,0,0.12);
  }

  .avatar {
    display: block;
    width: 108px;
    height: 108px;
    border-radius: 50%;
    object-fit: cover;
  }

  .user-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .username {
    font-size: 44px;
    font-weight: 800;
    color: #1d1d1f;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .date {
    font-size: 24px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.5);
    letter-spacing: 0.02em;
  }

  .message-body {
    padding: 10px 0;
  }

  .message-text {
    font-size: 56px;
    line-height: 1.25;
    font-weight: 700; /* 降低字重，笔画更清晰 */
    color: #000000; /* 纯黑色，提高对比度 */
    letter-spacing: -0.02em;
    word-break: break-word;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: geometricPrecision;
  }

  .highlight {
    color: #000000;
    background: #ffffff;
    padding: 8px 16px;
    border: 3px solid #000000;
    border-radius: 0;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    display: inline-block;
    font-weight: 900;
    letter-spacing: -0.01em;
  }


  .divider {
    height: 2px;
    background: rgba(0,0,0,0.15);
    border-radius: 2px;
    width: 100%;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .location-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .location-pill {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: #000000;
    padding: 12px 28px;
    border-radius: 100px;
    width: fit-content;
    transform: translateX(-12px); /* 向左偏移，修正视觉中心 */
  }

  .location-pill span {
    font-size: 26px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .landmark-name {
    font-size: 38px;
    font-weight: 900;
    color: #000000;
    letter-spacing: -0.01em;
    padding-left: 6px;
    opacity: 0.8;
    line-height: 1.2;
    word-break: break-word;
  }

  .brand-tag {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    opacity: 0.4;
  }

  .brand-icon {
    font-size: 50px;
    margin-bottom: 4px;
  }

  .brand-name {
    font-size: 20px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: #000000;
  }

  /* Layout cleanup overrides to avoid mixed style conflicts */
  .glass-card {
    border-radius: 48px;
    padding: 48px 56px 52px;
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    background: rgba(var(--card-tint, 255, 255, 255), 0.6);
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
  }

  .glass-card::before,
  .glass-card::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  .glass-card::before {
    border: 1.5px solid rgba(255, 255, 255, 0.75);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.9),
      inset 0 -16px 28px rgba(0, 0, 0, 0.08),
      0 0 22px rgba(255, 255, 255, 0.25);
    mix-blend-mode: screen;
  }

  .glass-card::after {
    background:
      linear-gradient(120deg, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0) 30%),
      linear-gradient(300deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 35%);
    opacity: 0.7;
  }

  .glass-card .glass-highlight {
    display: none;
  }

  .deco-circle,
  .deco-line,
  .deco-block-red,
  .tape-strip {
    display: none;
  }

  .geo-circle,
  .geo-rect,
  .geo-tri,
  .geo-arc,
  .geo-line {
    position: absolute;
    pointer-events: none;
    opacity: 0.25;
    z-index: 1;
  }

  .geo-circle {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    border: 3px solid rgba(78, 88, 110, 0.35);
    top: 210px;
    right: 120px;
  }

  .geo-rect {
    width: 220px;
    height: 72px;
    border-radius: 18px;
    border: 2px solid rgba(0, 122, 255, 0.25);
    top: 320px;
    right: 80px;
    transform: rotate(-3deg);
  }

  .geo-arc {
    width: 220px;
    height: 220px;
    border-radius: 50%;
    border: 2px solid rgba(78, 88, 110, 0.28);
    top: 260px;
    right: 140px;
    clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
  }

  .geo-line {
    width: 180px;
    height: 2px;
    background: rgba(78, 88, 110, 0.25);
    top: 430px;
    right: 110px;
    transform: rotate(-1deg);
  }

  .geo-tri {
    width: 0;
    height: 0;
    border-left: 48px solid transparent;
    border-right: 48px solid transparent;
    border-bottom: 90px solid rgba(78, 88, 110, 0.28);
    top: 300px;
    right: 250px;
    filter: none;
  }

  .card-content::before {
    content: none;
  }

  .header {
    gap: 32px;
  }

  .avatar-ring {
    padding: 0;
    background: transparent;
    border-radius: 50%;
    box-shadow: 8px 8px 0 #000000;
    border: 4px solid #000000;
  }

  .avatar {
    width: 120px;
    height: 120px;
    filter: contrast(1.05);
  }

  .user-meta {
    gap: 6px;
    justify-content: center;
  }

  .username {
    font-size: 48px;
    font-weight: 900;
    color: #000000;
    letter-spacing: -0.02em;
    line-height: 1;
    text-transform: uppercase;
    text-shadow: 2px 2px 0 rgba(255,255,255,0.6);
  }

  .date {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.05em;
    background: linear-gradient(90deg, var(--date-color), var(--date-color-light));
    padding: 4px 12px;
    width: fit-content;
    box-shadow: 4px 4px 0 #000000;
  }

  .message-body {
    padding-left: 0;
  }

  .message-text {
    font-family: var(--body-font);
    color: #1d1d1f; /* 深黑色，高可读性 */
  }

  .highlight {
    font-family: "Noto Serif SC", "Noto Serif SC Variable", "Noto Serif SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    font-weight: 900;
    font-size: 1.1em;
    color: #000000; /* 纯黑色文字 */
    background: #ffffff; /* 纯白底 */
    padding: 8px 16px;
    border: 3px solid #000000; /* 黑色边框 */
    box-shadow: 6px 6px 0 #000000; /* 黑色硬阴影 */
    border-radius: 0;
    display: inline-block;
    margin: 12px 0 0 0; /* 减少底部间距 */
    transform: translateY(8px); /* 向下偏移 */
  }

  .divider {
    margin-left: 0;
    width: 100%;
    background-image: none;
    opacity: 1;
  }

  .location-group {
    padding-left: 0;
  }

  .location-pill span .latin {
    font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  }

  .landmark-name {
    border-bottom: 0;
    transform: none;
    padding-left: 0;
    opacity: 0.9;
    font-family: "BBH Bartle", "BBH Sans Bartle", "BBH Bogle", "BBH Sans Bogle", "FZLanTingHei-B-GBK", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
    letter-spacing: 0.02em;
    font-size: 26px;
  }

  .brand-tag {
    opacity: 0.35;
  }

  .brand-icon {
    transform: none;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .brand-name {
    background: none;
    border: 0;
    padding: 0;
    font-family: "Bebas Neue", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  }
</style>
</head>
<body>
  <div class="wrapper">
    <img class="bg-image" src="${bgImage || ''}" alt="" crossorigin="anonymous" />
    <div class="bg-overlay"></div>

    <div class="card-container">
      <div class="glass-card">
        <!-- 装饰元素 -->
        <div class="deco-circle"></div>
        <div class="deco-line"></div>
        <div class="deco-block-red"></div>
        <div class="deco-dots"></div>
        <div class="tape-strip"></div>
        <div class="geo-circle"></div>
        <div class="geo-rect"></div>
        <div class="geo-tri"></div>
        <div class="geo-arc"></div>
        <div class="geo-line"></div>

        <div class="card-content">

          <div class="header">
            <div class="avatar-ring">
              <img class="avatar" src="${avatarUrl}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=random'" />
            </div>
            <div class="user-meta">
              <div class="username">${escapeHtml(username)}</div>
              <div class="date">${dateStr}</div>
            </div>
          </div>

          <div class="message-body">
            <div class="message-text">
              今天 ${pigInline}猪醒在<br/>
              <span class="highlight">${data.location.landmarkZh || data.location.landmark}</span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="footer">
            <div class="location-group">
              <div class="location-pill">
                <span>📍 ${data.location.countryZh || data.location.country} · <span class="latin">${data.location.city}</span></span>
              </div>
              <div class="landmark-name">${data.location.landmark}</div>
            </div>

            <div class="brand-tag">
              <div class="brand-icon">${pigBrand}</div>
              <div class="brand-name">Pig<br/>Travel</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <script>
    async function waitForImages() {
      console.log('Starting waitForImages...');
      // 1. Wait for standard img tags
      const images = Array.from(document.images);
      console.log('Found ' + images.length + ' standard images');

      // 2. Identify and wait for background images
      const bgImages = [];
      const allElements = document.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        const bg = window.getComputedStyle(allElements[i]).backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const urlMatch = bg.match(/url\(\s*?["']?(.+?)["']?\s*?\)/);
          if (urlMatch && urlMatch[1]) {
            const url = urlMatch[1];
            // Skip data URLs as they don't need pre-loading and can be fragile in Image constructor
            if (url.startsWith('data:')) {
              console.log('Skipping data-url pre-load');
              continue;
            }
            console.log('Found background image: ' + url);
            const img = new Image();
            img.src = url;
            bgImages.push(img);
          }
        }
      }

      const allToLoad = [...images, ...bgImages];
      console.log('Total images to load: ' + allToLoad.length);
      const promises = allToLoad.map((img, index) => {
        if (img.complete) {
          console.log('Image ' + index + ' already complete: ' + img.src);
          return Promise.resolve();
        }
        return new Promise(resolve => {
          img.onload = () => {
            console.log('Image ' + index + ' loaded successfully: ' + img.src);
            resolve();
          };
          img.onerror = () => {
            console.warn('Image ' + index + ' failed to load: ' + img.src);
            resolve();
          };
        });
      });

      await Promise.all([
        ...promises,
        document.fonts.ready
      ]);

      console.log('All images and fonts loaded');
      // Extra safety delay for rendering (reduced from 400ms)
      await new Promise(r => setTimeout(r, 200));
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
      page.on('console', msg => ctx.logger('pig').debug(`[Browser] ${msg.text()}`))
      page.on('requestfailed', request => {
        ctx.logger('pig').warn(`[Browser] Request failed: ${request.url()} - ${request.failure()?.errorText}`)
      })
    }

    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 })
    // Use domcontentloaded instead of networkidle0 for faster loading
    // The waitForImages script will handle waiting for actual images
    await page.setContent(html, { waitUntil: 'domcontentloaded' })

    // Use a longer timeout for LLM/Network stability
    await page.evaluate(() => window['renderReady'])

    const buffer = await page.screenshot({ type: 'png', fullPage: true }) as Buffer
    const filename = `pig_${userInfo.userId}_${now.getTime()}.png`
    ctx.logger('pig').info(`足迹卡片已生成: ${filename}`)

    return { buffer, filename }
  } catch (e) {
    ctx.logger('pig').error('Failed to generate card', e)
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
