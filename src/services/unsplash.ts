import { Context } from 'koishi'

const UNSPLASH_API_BASE = 'https://api.unsplash.com'

interface UnsplashPhotoUrls {
  raw: string
  full: string
  regular: string
  small: string
  thumb: string
}

interface UnsplashPhoto {
  id: string
  urls: UnsplashPhotoUrls
}

interface UnsplashSearchResponse {
  total: number
  total_pages: number
  results: UnsplashPhoto[]
}

/**
 * Search for a photo on Unsplash and return the regular-sized URL
 * @returns The photo URL or null if not found/error
 */
export async function searchUnsplashPhoto(
  ctx: Context,
  accessKey: string,
  query: string,
  debug = false
): Promise<string | null> {
  if (!accessKey) {
    if (debug) ctx.logger('pig').debug('Unsplash: No access key provided')
    return null
  }

  try {
    if (debug) ctx.logger('pig').debug(`Unsplash: Searching for "${query}"`)

    const response = await ctx.http.get<UnsplashSearchResponse>(
      `${UNSPLASH_API_BASE}/search/photos`,
      {
        params: {
          query,
          per_page: 1,
          orientation: 'landscape',
        },
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          'Accept-Version': 'v1',
        },
        timeout: 10000,
      }
    )

    if (response.results && response.results.length > 0) {
      // Use regular resolution (1080px width) for optimal size/quality balance
      let photoUrl = response.results[0].urls.regular
      // Append webp format and quality params via Imgix (Unsplash's image processing service)
      if (photoUrl.includes('?')) {
        photoUrl += '&fm=webp&q=85'
      } else {
        photoUrl += '?fm=webp&q=85'
      }
      if (debug) ctx.logger('pig').debug(`Unsplash: Found photo URL: ${photoUrl}`)
      return photoUrl
    }

    if (debug) ctx.logger('pig').debug('Unsplash: No photos found for query')
    return null
  } catch (e) {
    ctx.logger('pig').warn(`Unsplash API error: ${e}`)
    return null
  }
}
