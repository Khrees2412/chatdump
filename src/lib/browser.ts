import { createRequire } from 'node:module'
import {
  extractGeminiConversationPayloads,
  isGeminiConversationResponseUrl,
} from './gemini'
import type { BrowserExtractResult } from './types'
import { tryNormalizeShareUrl, type ShareProvider } from './url'

const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000
const BROWSER_SIGNAL_TIMEOUT_MS = 5_000
const require = createRequire(import.meta.url)

type PlaywrightModule = {
  chromium?: any
}

type ServerlessChromiumModule = {
  args: string[]
  executablePath: () => Promise<string>
}

type ServerlessBrowserRuntime = {
  chromiumPackage: ServerlessChromiumModule
  playwrightCore: PlaywrightModule
}

type PlaywrightBrowser = {
  close: () => Promise<void>
  newPage: (options?: Record<string, unknown>) => Promise<any>
}

export async function extractConversationInBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  if (isVercelRuntime()) {
    return extractConversationInServerlessBrowser(url)
  }

  const resolvedPackagePath = resolveModulePath('playwright/package.json')
  logInfo('Playwright fallback invoked', {
    node: process.version,
    playwrightPackagePath: resolvedPackagePath,
    runtime: 'local-playwright',
    url,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })

  const playwright = await loadPlaywright()

  if (!playwright?.chromium) {
    logWarn('Playwright module is unavailable in this runtime', {
      playwrightPackagePath: resolvedPackagePath,
      url,
    })
    return null
  }

  const executablePath = getExecutablePath(playwright)

  logInfo('Playwright module loaded', {
    executablePath: getSafeExecutablePath(executablePath),
    url,
  })

  const browser = await playwright.chromium.launch({
    headless: true,
  })

  logInfo('Playwright browser launched', { url })

  try {
    return await extractConversationFromLaunchedBrowser(browser, url)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function extractConversationInServerlessBrowser(
  url: string,
): Promise<BrowserExtractResult | null> {
  const runtime = await loadServerlessBrowserRuntime()

  if (!runtime?.playwrightCore.chromium) {
    logWarn('Serverless browser runtime is unavailable', { url })
    return null
  }

  const executablePath = await runtime.chromiumPackage.executablePath()

  logInfo('Playwright fallback invoked', {
    executablePath: getSafeExecutablePath(executablePath),
    node: process.version,
    playwrightCorePackagePath: resolveModulePath('playwright-core'),
    runtime: 'vercel-serverless',
    serverlessChromiumPackagePath: resolveModulePath('@sparticuz/chromium'),
    url,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })

  const browser = await runtime.playwrightCore.chromium.launch({
    args: runtime.chromiumPackage.args,
    executablePath,
    headless: true,
  })

  logInfo('Playwright browser launched', { url })

  try {
    return await extractConversationFromLaunchedBrowser(browser, url)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

async function extractConversationFromLaunchedBrowser(
  browser: PlaywrightBrowser,
  url: string,
): Promise<BrowserExtractResult> {
  const provider = detectShareProvider(url)
  const page = await browser.newPage({
    userAgent: 'chatdump/0.1 (+browser fallback)',
  })
  const warnings: string[] = []
  const geminiPayloadsPromise =
    provider === 'gemini' ? waitForGeminiConversationPayloads(page, url) : null

  try {
    await page.goto(url, {
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    })

    logInfo('Playwright page loaded', {
      pageUrl: page.url(),
      provider,
      title: await page.title().catch(() => ''),
      url,
    })

    if (provider === 'gemini') {
      warnings.push(...(await maybeAcceptGeminiConsent(page, url)))
    }

    await waitForProviderSignal(page, provider)

    const pageResult = await snapshotPage(page)
    const geminiPayloads =
      provider === 'gemini' && geminiPayloadsPromise
        ? await geminiPayloadsPromise
        : []

    const result = {
      ...pageResult,
      payloads: [...(pageResult.payloads ?? []), ...geminiPayloads],
      warnings,
    } satisfies BrowserExtractResult

    logInfo('Playwright browser extraction completed', {
      payloadCount: result.payloads?.length ?? 0,
      provider,
      sourceUrl: result.sourceUrl,
      url,
      warningCount: warnings.length,
    })

    return result
  } catch (cause) {
    logError('Playwright browser extraction failed', {
      error: getErrorMessage(cause),
      provider,
      url,
    })
    throw cause
  }
}

function detectShareProvider(url: string): ShareProvider {
  return tryNormalizeShareUrl(url)?.provider ?? 'chatgpt'
}

async function waitForProviderSignal(page: any, provider: ShareProvider) {
  const signal =
    provider === 'gemini'
      ? () =>
          Boolean(
            document.querySelector('chat-app') &&
              /(?:^|\n)\s*You said(?:\n|$)/i.test(document.body.innerText),
          )
      : () => {
          const globalScope = window as unknown as Record<string, unknown>

          return Boolean(
            globalScope.__NEXT_DATA__ ||
              globalScope.__staticRouterHydrationData ||
              (globalScope.__reactRouterDataRouter as { state?: unknown } | undefined)?.state ||
              globalScope.__remixContext ||
              document.querySelector('[data-message-author-role]'),
          )
        }

  await page
    .waitForFunction(signal, {
      timeout: BROWSER_SIGNAL_TIMEOUT_MS,
    })
    .catch(() => undefined)
}

async function waitForGeminiConversationPayloads(
  page: any,
  url: string,
): Promise<unknown[]> {
  try {
    const response = await page.waitForResponse(
      (candidate: any) => isGeminiConversationResponseUrl(candidate.url()),
      {
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
      },
    )
    const responseText = await response.text()
    const payloads = extractGeminiConversationPayloads(responseText)

    logInfo('Captured Gemini conversation payload', {
      payloadCount: payloads.length,
      responseUrl: response.url(),
      url,
    })

    return payloads
  } catch (cause) {
    logWarn('Gemini conversation payload capture did not complete', {
      error: getErrorMessage(cause),
      url,
    })
    return []
  }
}

async function maybeAcceptGeminiConsent(
  page: any,
  url: string,
): Promise<string[]> {
  const acceptAllButton = page.getByRole('button', { name: /accept all/i }).first()
  const isVisible = await acceptAllButton
    .isVisible({ timeout: 2_000 })
    .catch(() => false)

  if (!isVisible) {
    return []
  }

  await Promise.allSettled([
    page.waitForURL(/gemini\.google\.com\/share\//, {
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
    }),
    acceptAllButton.click({ timeout: 3_000 }),
  ])

  await page
    .waitForLoadState('domcontentloaded', {
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
    })
    .catch(() => undefined)

  logInfo('Accepted Gemini consent page', {
    pageUrl: page.url(),
    url,
  })

  return ['Accepted the Gemini consent page in browser fallback.']
}

async function snapshotPage(page: any): Promise<BrowserExtractResult> {
  return page.evaluate(() => {
    const globalScope = window as unknown as Record<string, unknown>
    const routerData = globalScope.__reactRouterDataRouter as
      | { state?: { loaderData?: unknown } }
      | undefined
    const remixData = globalScope.__remixContext as
      | { state?: { loaderData?: unknown } }
      | undefined
    const staticRouterData = globalScope.__staticRouterHydrationData as
      | { loaderData?: unknown }
      | undefined

    return {
      html: document.documentElement.outerHTML,
      payloads: [
        globalScope.__NEXT_DATA__,
        staticRouterData,
        staticRouterData?.loaderData,
        routerData?.state,
        routerData?.state?.loaderData,
        remixData,
        remixData?.state,
        remixData?.state?.loaderData,
      ].filter((value) => Boolean(value)),
      sourceUrl: window.location.href,
    } satisfies BrowserExtractResult
  })
}

async function loadServerlessBrowserRuntime(): Promise<ServerlessBrowserRuntime | null> {
  const chromiumPackagePath = resolveModulePath('@sparticuz/chromium')
  const playwrightCorePackagePath = resolveModulePath('playwright-core')

  let chromiumPackage: ServerlessChromiumModule | null = null

  try {
    chromiumPackage = require('@sparticuz/chromium')
  } catch (cause) {
    logWarn('Serverless Chromium require failed', {
      chromiumPackagePath,
      error: getErrorMessage(cause),
    })
    return null
  }

  let playwrightCore: PlaywrightModule | null = null

  try {
    playwrightCore = require('playwright-core')
  } catch (cause) {
    logWarn('playwright-core require failed', {
      error: getErrorMessage(cause),
      playwrightCorePackagePath,
    })
    return null
  }

  if (
    !chromiumPackage ||
    !Array.isArray(chromiumPackage.args) ||
    typeof chromiumPackage.executablePath !== 'function'
  ) {
    logWarn('Serverless Chromium module shape is invalid', {
      chromiumPackagePath,
    })
    return null
  }

  if (!playwrightCore) {
    return null
  }

  logInfo('Serverless browser runtime loaded', {
    chromiumPackagePath,
    playwrightCorePackagePath,
  })

  return {
    chromiumPackage,
    playwrightCore,
  }
}

async function loadPlaywright(): Promise<{ chromium?: any } | null> {
  const moduleName = 'playwright'

  try {
    return await import(/* @vite-ignore */ moduleName)
  } catch (importCause) {
    logWarn('Playwright import failed', {
      error: getErrorMessage(importCause),
      moduleName,
    })
  }

  try {
    return require(moduleName)
  } catch (requireCause) {
    logWarn('Playwright require fallback failed', {
      error: getErrorMessage(requireCause),
      moduleName,
    })
    return null
  }
}

function getExecutablePath(playwright: { chromium?: any }): string | null {
  try {
    return typeof playwright.chromium?.executablePath === 'function'
      ? playwright.chromium.executablePath()
      : null
  } catch {
    return null
  }
}

function resolveModulePath(specifier: string): string | null {
  try {
    return require.resolve(specifier)
  } catch {
    return null
  }
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }

  return String(cause)
}

function getSafeExecutablePath(path: string | null): string | null {
  if (!path) {
    return null
  }

  return path.length > 140 ? `${path.slice(0, 137)}...` : path
}

function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
}

function logInfo(message: string, details: Record<string, unknown>) {
  console.info(`[chatdump] ${message}`, details)
}

function logWarn(message: string, details: Record<string, unknown>) {
  console.warn(`[chatdump] ${message}`, details)
}

function logError(message: string, details: Record<string, unknown>) {
  console.error(`[chatdump] ${message}`, details)
}
