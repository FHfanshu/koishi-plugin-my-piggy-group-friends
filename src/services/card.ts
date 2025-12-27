import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { Location } from '../constants'
import { Config } from '../config'
import { UserInfo } from './travel'

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

  const inlineMaxBytes = 900 * 1024

  const fetchToDataUrl = async (url: string) => {
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
      try {
        if (config.debug) ctx.logger('pig').debug(`Server-side fetching background: ${normalized}`)
        const response = await ctx.http(normalized, {
          responseType: 'arraybuffer',
          timeout: 8000,  // Reduced from 15s to 8s for better responsiveness
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
        })
        const contentType = response.headers.get('content-type') || ''
        const contentLength = response.headers.get('content-length') || 'unknown'
        if (config.debug) {
          ctx.logger('pig').debug(
            `Background fetch response: status=${response.status} url=${response.url} content-type=${contentType || 'unknown'} content-length=${contentLength}`
          )
        }
        if (!contentType.startsWith('image/')) {
          if (config.debug) ctx.logger('pig').warn(`Background fetch returned non-image content-type: ${contentType || 'unknown'}`)
          return null
        }
        const buffer = Buffer.from(response.data as ArrayBuffer)
        const mime = sniffMime(buffer)
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

  if (bgImage) {
    bgImage = normalizeImageUrl(bgImage)
    const fetched = await fetchToDataUrl(bgImage)
    if (fetched) {
      bgImage = fetched
      if (config.debug && fetched.startsWith('data:')) {
        ctx.logger('pig').debug(`Successfully converted background to base64 (length=${fetched.length})`)
      }
    } else {
      // If fetch failed, just use the normalized URL directly and let puppeteer try
      // Skip fallback fetch to avoid double timeout delays
      if (config.debug) ctx.logger('pig').warn('Background fetch failed, proceeding with URL directly (no fallback fetch)')
    }
    if (config.debug) {
      ctx.logger('pig').debug(`Final background value: ${bgImage ? (bgImage.startsWith('data:') ? `data-url(${bgImage.length})` : bgImage) : 'none'}`)
    }
  }

  // Format date in Chinese
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
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
    /* Prioritize system fonts with wide Unicode coverage for emoji and CJK support */
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Micro Hei", "Droid Sans Fallback", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji";
    background: #f0f0f2;
    --bg-image: url('${bgImage}');
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
    background-color: #d1d1d6;
    background-image: var(--bg-image);
    background-size: cover;
    background-position: center;
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

  /* Advanced Liquid Glass Card (Based on user request) */
  .glass-card {
    position: relative;
    border-radius: 56px;
    padding: 56px 60px 60px;
    overflow: hidden;

    /* 基础半透明底色，保证文字可读性 */
    background: rgba(255, 255, 255, 0.45);

    /* 细腻的边框 */
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-top: 1px solid rgba(255, 255, 255, 0.8);
    border-bottom: 1px solid rgba(255, 255, 255, 0.3);

    box-shadow:
      0 40px 80px -20px rgba(0,0,0,0.3),
      inset 0 0 0 1px rgba(255,255,255,0.3);
  }

  /* 模拟厚度与折射 (Refraction Layer) */
  .glass-card::after {
    content: "";
    position: absolute;
    inset: 0;
    /* Use scroll instead of fixed to avoid Puppeteer rendering issues */
    background-image: var(--bg-image);
    background-attachment: scroll;
    background-size: cover;
    background-position: center bottom;

    /* 模糊处理，模拟毛玻璃内部的散射 */
    filter: blur(25px) brightness(1.1);
    opacity: 0.7;
    z-index: -1;

    /* 稍微缩小一点范围，制造边缘的玻璃厚度感 */
    margin: 4px;
    border-radius: 52px;
  }

  /* 强力滤镜层 (Filter Layer) */
  .glass-card::before {
    content: "";
    position: absolute;
    inset: -20%;
    width: 140%;
    height: 140%;

    /* 高级滤镜组合：模糊 + 饱和度提升 + 对比度微调 */
    backdrop-filter: blur(40px) saturate(180%) contrast(110%);
    -webkit-backdrop-filter: blur(40px) saturate(180%) contrast(110%);

    z-index: -2;
  }

  /* Noise Texture - Moved to .card-content::before */
  .card-content::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.05'/%3E%3C/svg%3E");
    opacity: 0.1;
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
    gap: 36px;
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
    font-weight: 800;
    color: #1d1d1f;
    letter-spacing: -0.03em;
    word-break: break-word;
  }

  .highlight {
    color: #007AFF;
    background: linear-gradient(120deg, rgba(0,122,255,0.08) 0%, rgba(0,122,255,0.15) 100%);
    padding: 2px 12px;
    border-radius: 14px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    display: inline-block;
  }

  .divider {
    height: 2px;
    background: rgba(0,0,0,0.08);
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
    background: #007AFF;
    padding: 12px 28px;
    border-radius: 100px;
    box-shadow: 0 8px 20px rgba(0,122,255,0.25);
    width: fit-content;
  }

  .location-pill span {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .landmark-name {
    font-size: 38px;
    font-weight: 800;
    color: #1d1d1f;
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
    color: #1d1d1f;
  }
</style>
</head>
<body>
  <div class="wrapper">
    <div class="bg-image"></div>
    <div class="bg-overlay"></div>

    <div class="card-container">
      <div class="glass-card">
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
              今天 🐷猪醒在<br/>
              <span class="highlight">${data.location.landmarkZh || data.location.landmark}</span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="footer">
            <div class="location-group">
              <div class="location-pill">
                <span>📍 ${data.location.countryZh || data.location.country} · ${data.location.city}</span>
              </div>
              <div class="landmark-name">${data.location.landmark}</div>
            </div>

            <div class="brand-tag">
              <div class="brand-icon">🐷</div>
              <div class="brand-name">Pig Travel</div>
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
