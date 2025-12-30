import { Context } from 'koishi'

/**
 * 获取群组统一背景图（从 pig_guild_config 表）
 * 仅返回管理员设置的群组背景，不再从用户个人设置中获取
 */
export async function getAdminBackgroundImage(
  ctx: Context,
  platform: string,
  guildId: string
): Promise<string | undefined> {
  if (!guildId) return undefined

  // 从群组配置表获取背景
  const [guildConfig] = await ctx.database.get('pig_guild_config', { platform, guildId })
  return guildConfig?.backgroundImage
}

/**
 * 设置群组统一背景图（仅管理员可调用）
 */
export async function setGuildBackgroundImage(
  ctx: Context,
  platform: string,
  guildId: string,
  backgroundImage: string | null,
  setByUserId: string
): Promise<void> {
  if (backgroundImage === null) {
    // 重置背景
    await ctx.database.remove('pig_guild_config', { platform, guildId })
  } else {
    await ctx.database.upsert('pig_guild_config', [{
      platform,
      guildId,
      backgroundImage,
      backgroundSetBy: setByUserId,
      backgroundSetAt: new Date(),
    }], ['platform', 'guildId'])
  }
}

/**
 * 获取群组背景配置信息（包含设置者信息）
 */
export async function getGuildBackgroundInfo(
  ctx: Context,
  platform: string,
  guildId: string
): Promise<{ backgroundImage?: string; setBy?: string; setAt?: Date } | undefined> {
  if (!guildId) return undefined

  const [guildConfig] = await ctx.database.get('pig_guild_config', { platform, guildId })
  if (!guildConfig?.backgroundImage) return undefined

  return {
    backgroundImage: guildConfig.backgroundImage,
    setBy: guildConfig.backgroundSetBy,
    setAt: guildConfig.backgroundSetAt,
  }
}
