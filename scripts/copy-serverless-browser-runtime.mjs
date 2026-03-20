import { constants } from 'node:fs'
import { access, cp, mkdir, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceNodeModulesDir = path.join(rootDir, 'node_modules')
const runtimePackages = ['@sparticuz/chromium', 'playwright-core', 'chromium-bidi']

await assertExists(sourceNodeModulesDir, 'Project node_modules directory is missing')

const targetNodeModulesDirs = dedupe([
  path.join(rootDir, '.output', 'server', 'node_modules'),
  ...(await resolveVercelFunctionNodeModulesDirs()),
])

for (const targetNodeModulesDir of targetNodeModulesDirs) {
  await mkdir(targetNodeModulesDir, { recursive: true })

  const copiedPackages = new Set()

  for (const packageName of runtimePackages) {
    await copyPackageTree(packageName, targetNodeModulesDir, copiedPackages)
  }

  console.info('[chatdump][build] Prepared serverless browser runtime', {
    packageCount: copiedPackages.size,
    targetNodeModulesDir,
  })
}

async function copyPackageTree(packageName, targetNodeModulesDir, copiedPackages) {
  if (copiedPackages.has(packageName)) {
    return
  }

  const sourcePackageDir = resolvePackageDir(sourceNodeModulesDir, packageName)
  const sourcePackageJsonPath = path.join(sourcePackageDir, 'package.json')
  await assertExists(sourcePackageJsonPath, 'Runtime package is missing')

  const targetPackageDir = resolvePackageDir(targetNodeModulesDir, packageName)
  await mkdir(path.dirname(targetPackageDir), { recursive: true })
  await cp(sourcePackageDir, targetPackageDir, {
    force: true,
    recursive: true,
  })

  copiedPackages.add(packageName)

  console.info('[chatdump][build] Copied runtime package', {
    packageName,
    targetPackageDir,
  })

  const packageJson = JSON.parse(await readFile(sourcePackageJsonPath, 'utf8'))
  const runtimeDependencies = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]

  for (const dependencyName of runtimeDependencies) {
    const dependencyPackageJsonPath = path.join(
      resolvePackageDir(sourceNodeModulesDir, dependencyName),
      'package.json',
    )

    if (!(await exists(dependencyPackageJsonPath))) {
      console.warn('[chatdump][build] Skipped unresolved runtime dependency', {
        dependencyName,
        packageName,
      })
      continue
    }

    await copyPackageTree(dependencyName, targetNodeModulesDir, copiedPackages)
  }
}

async function resolveVercelFunctionNodeModulesDirs() {
  const functionsRoot = path.join(rootDir, '.vercel', 'output', 'functions')

  if (!(await exists(functionsRoot))) {
    return []
  }

  const entries = await readdir(functionsRoot, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.func'))
    .map((entry) => path.join(functionsRoot, entry.name, 'node_modules'))
}

function resolvePackageDir(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'))
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
