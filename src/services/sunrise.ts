import { Context } from 'koishi'

export interface SunriseInfo {
  sunrise: Date
  sunset: Date
}

export async function getSunriseInfo(ctx: Context, lat: number, lng: number, date: string = 'today'): Promise<SunriseInfo> {
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0&date=${date}`
  const data = await ctx.http.get(url, { timeout: 8000 })

  if (data.status !== 'OK') {
    throw new Error('Failed to fetch sunrise info')
  }

  return {
    sunrise: new Date(data.results.sunrise),
    sunset: new Date(data.results.sunset),
  }
}
