import { Context } from 'koishi'
import { PigUserState } from '../database'

export async function getAdminBackgroundImage(
  ctx: Context,
  platform: string,
  guildId: string
): Promise<string | undefined> {
  if (!guildId) return undefined

  const states = await ctx.database.get('pig_user_state', { guildId, platform })
  const candidates = states.filter(state => state.backgroundImage)
  if (!candidates.length) return undefined

  let selected: PigUserState | undefined
  let bestAuthority = 3
  for (const state of candidates) {
    const user = await ctx.database.getUser(platform, state.userId, ['authority'])
    const authority = user?.authority ?? 0
    if (authority > bestAuthority) {
      selected = state
      bestAuthority = authority
    }
  }

  return selected?.backgroundImage
}
