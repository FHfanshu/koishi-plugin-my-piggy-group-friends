import { existsSync } from 'fs'
import { access, copyFile, mkdir, readdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'

let cachedSvgFiles: string[] | null = null
let pigSvgDirOverride: string | null = null

function findPigSvgDir(startDir: string): string | null {
  let current = startDir
  for (let i = 0; i < 6; i++) {
    const candidate = join(current, 'pig_svgs')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function getPackageSvgDir(): string {
  return findPigSvgDir(__dirname) ?? join(__dirname, 'pig_svgs')
}

export function setPigSvgDir(dir: string) {
  pigSvgDirOverride = dir
  cachedSvgFiles = null
}

async function resolveSvgDirFromCandidates(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), 'data', 'pig', 'svgs'),
    join(process.cwd(), '..', 'data', 'pig', 'svgs'),
    join(process.cwd(), '..', '..', 'data', 'pig', 'svgs'),
    getPackageSvgDir(),
  ]
  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    try {
      const entries = await readdir(dir)
      if (entries.some(name => name.toLowerCase().endsWith('.svg'))) {
        pigSvgDirOverride = dir
        return dir
      }
    } catch {
      // ignore
    }
  }
  return null
}

export async function getPigSvgDirResolved(): Promise<string | null> {
  if (pigSvgDirOverride) return pigSvgDirOverride
  return await resolveSvgDirFromCandidates()
}

async function getPigSvgFiles(): Promise<string[]> {
  if (cachedSvgFiles) return cachedSvgFiles
  try {
    let svgDir = pigSvgDirOverride
    if (!svgDir) {
      svgDir = await resolveSvgDirFromCandidates()
    }
    if (!svgDir) {
      cachedSvgFiles = []
      return cachedSvgFiles
    }
    if (!existsSync(svgDir)) {
      cachedSvgFiles = []
      return cachedSvgFiles
    }
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
  const filtered = files.filter(file => !file.toLowerCase().endsWith('owl.svg'))
  if (!filtered.length) return null
  const pick = filtered[Math.floor(Math.random() * filtered.length)]
  try {
    const buffer = await readFile(pick)
    return `data:image/svg+xml;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function getPigSvgDataUrlByName(filename: string): Promise<string | null> {
  try {
    let baseDir = pigSvgDirOverride
    if (!baseDir) {
      baseDir = await resolveSvgDirFromCandidates()
    }
    if (!baseDir) return null
    if (!existsSync(baseDir)) return null
    const svgPath = join(baseDir, filename)
    const buffer = await readFile(svgPath)
    return `data:image/svg+xml;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

export async function ensurePigSvgAssets(targetDir: string): Promise<void> {
  const sourceDir = getPackageSvgDir()
  if (!existsSync(sourceDir)) return
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
