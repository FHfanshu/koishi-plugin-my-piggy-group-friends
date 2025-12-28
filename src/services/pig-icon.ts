import { access, copyFile, mkdir, readdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

let cachedSvgFiles: string[] | null = null
let pigSvgDirOverride: string | null = null

function getPackageSvgDir(): string {
  const baseDir = dirname(fileURLToPath(import.meta.url))
  return join(baseDir, '..', '..', 'pig_svgs')
}

export function setPigSvgDir(dir: string) {
  pigSvgDirOverride = dir
  cachedSvgFiles = null
}

async function getPigSvgFiles(): Promise<string[]> {
  if (cachedSvgFiles) return cachedSvgFiles
  try {
    const svgDir = pigSvgDirOverride || getPackageSvgDir()
    const entries = await readdir(svgDir)
    cachedSvgFiles = entries
      .filter(name => name.toLowerCase().endsWith('.svg'))
      .map(name => join(svgDir, name))
  } catch {
    cachedSvgFiles = []
  }
  return cachedSvgFiles
}

export async function getRandomPigSvgDataUrl(): Promise<string | null> {
  const files = await getPigSvgFiles()
  if (!files.length) return null
  const pick = files[Math.floor(Math.random() * files.length)]
  try {
    const buffer = await readFile(pick)
    return `data:image/svg+xml;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function getPigSvgDataUrlByName(filename: string): Promise<string | null> {
  try {
    const baseDir = pigSvgDirOverride || getPackageSvgDir()
    const svgPath = join(baseDir, filename)
    const buffer = await readFile(svgPath)
    return `data:image/svg+xml;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function ensurePigSvgAssets(targetDir: string): Promise<void> {
  const sourceDir = getPackageSvgDir()
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir)
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.svg')) continue
    const src = join(sourceDir, name)
    const dest = join(targetDir, name)
    try {
      await access(dest)
    } catch {
      await copyFile(src, dest)
    }
  }
}
