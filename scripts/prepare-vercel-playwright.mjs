import { access, cp, mkdir, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vercelFunctionsDir = path.join(rootDir, '.vercel', 'output', 'functions')
const playwrightPackages = ['playwright', 'playwright-core']

await assertExists(vercelFunctionsDir, 'Expected Vercel functions output to exist')

const functionDir = await resolveServerFunctionDir(vercelFunctionsDir)
const targetNodeModulesDir = path.join(functionDir, 'node_modules')

await mkdir(targetNodeModulesDir, { recursive: true })

for (const packageName of playwrightPackages) {
  const sourceDir = path.join(rootDir, 'node_modules', packageName)
  const targetDir = path.join(targetNodeModulesDir, packageName)

  await assertExists(sourceDir, `Missing ${packageName} in node_modules`)
  await cp(sourceDir, targetDir, {
    force: true,
    recursive: true,
  })

  console.info('[chatdump][build] Copied package into Vercel function bundle', {
    packageName,
    targetDir,
  })
}

const hermeticBrowsersDir = path.join(
  rootDir,
  'node_modules',
  'playwright-core',
  '.local-browsers',
)

await assertExists(
  hermeticBrowsersDir,
  'Hermetic Playwright browser install is missing; expected node_modules/playwright-core/.local-browsers',
)

console.info('[chatdump][build] Hermetic Playwright browsers are present', {
  hermeticBrowsersDir,
  functionDir,
})

async function resolveServerFunctionDir(functionsDir) {
  const entries = await readdir(functionsDir, { withFileTypes: true })
  const functionNames = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.func'))
    .map((entry) => entry.name)

  if (functionNames.length !== 1) {
    throw new Error(
      `Expected exactly one Vercel function directory, found ${functionNames.length}: ${functionNames.join(', ')}`,
    )
  }

  return path.join(functionsDir, functionNames[0])
}

async function assertExists(targetPath, message) {
  try {
    await access(targetPath, constants.F_OK)
  } catch {
    throw new Error(`${message}: ${targetPath}`)
  }
}
