import { Context } from 'koishi'

const PEXELS_API_BASE = 'https://api.pexels.com/v1'

interface PexelsPhoto {
  id: number
  width: number
  height: number
  url: string
  photographer: string
  src: {
    original: string
    large2x: string
    large: string
    medium: string
    small: string
    portrait: string
    landscape: string
    tiny: string
  }
}

interface PexelsSearchResponse {
  total_results: number
  page: number
  per_page: number
  photos: PexelsPhoto[]
}

/**
 * Search for a photo on Pexels and return a randomly selected large-sized URL
 * Fetches multiple results and randomly selects one to avoid repetitive images
 * @returns The photo URL or null if not found/error
 */
export async function searchPexelsPhoto(
  ctx: Context,
  apiKey: string,
  query: string,
  debug = false
): Promise<string | null> {
  if (!apiKey) {
    if (debug) ctx.logger('pig').debug('Pexels: No API key provided')
    return null
  }

  try {
    if (debug) ctx.logger('pig').debug(`Pexels: Searching for "${query}"`)

    const response = await ctx.http.get<PexelsSearchResponse>(
      `${PEXELS_API_BASE}/search`,
      {
        params: {
          query,
          per_page: 10, // Fetch more results for variety
          orientation: 'landscape',
        },
        headers: {
          Authorization: apiKey,
        },
        timeout: 10000,
      }
    )

    if (response.photos && response.photos.length > 0) {
      // Randomly select one of the results for variety
      const randomIndex = Math.floor(Math.random() * response.photos.length)
      const selectedPhoto = response.photos[randomIndex]

      // Use large resolution (usually around 940px width, but pexels serves high quality)
      // or we can use custom sizing via params if needed
      let photoUrl = selectedPhoto.src.large2x || selectedPhoto.src.large

      // Pexels URLs often already contain params like auto=compress&cs=tinysrgb&h=650&w=940
      // We can adjust them for our needs (1080px width)
      if (photoUrl.includes('w=')) {
        photoUrl = photoUrl.replace(/w=\d+/, 'w=1080')
      } else if (photoUrl.includes('?')) {
        photoUrl += '&w=1080'
      } else {
        photoUrl += '?w=1080'
      }

      if (debug) ctx.logger('pig').debug(`Pexels: Selected photo ${randomIndex + 1}/${response.photos.length}, URL: ${photoUrl}`)
      return photoUrl
    }

    if (debug) ctx.logger('pig').debug('Pexels: No photos found for query')
    return null
  } catch (e) {
    ctx.logger('pig').warn(`Pexels API error: ${e}`)
    return null
  }
}
