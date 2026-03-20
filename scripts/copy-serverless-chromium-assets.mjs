import { access, cp, mkdir, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(rootDir, 'node_modules', '@sparticuz', 'chromium', 'bin')

await assertExists(sourceDir, 'Chromium asset source is missing')

const targetDirs = [
  path.join(rootDir, '.output', 'bin'),
  path.join(rootDir, '.output', 'server', 'bin'),
  ...(await resolveVercelFunctionBinDirs()),
]

for (const targetDir of dedupe(targetDirs)) {
  await mkdir(targetDir, { recursive: true })
  await cp(sourceDir, targetDir, {
    force: true,
    recursive: true,
  })

  console.info('[chatdump][build] Copied serverless Chromium assets', {
    sourceDir,
    targetDir,
  })
}

async function resolveVercelFunctionBinDirs() {
  const functionsRoot = path.join(rootDir, '.vercel', 'output', 'functions')

  if (!(await exists(functionsRoot))) {
    return []
  }

  const entries = await readdir(functionsRoot, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.func'))
    .map((entry) => path.join(functionsRoot, entry.name, 'bin'))
}

async function exists(targetPath) {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function assertExists(targetPath, message) {
  if (!(await exists(targetPath))) {
    throw new Error(`${message}: ${targetPath}`)
  }
}

function dedupe(values) {
  return [...new Set(values)]
}
