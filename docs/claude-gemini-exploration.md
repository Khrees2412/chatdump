# Claude and Gemini Support Exploration

Branch: `explore-claude-gemini-support`

Date: 2026-03-20

## Summary

Supporting additional providers splits into two very different tracks:

- Gemini looks feasible, but it is not a small toggle. The current project needs a provider abstraction, Gemini URL support, and a Gemini-specific extractor because the current ChatGPT parser does not recognize Gemini's public share page structure.
- Claude is blocked earlier in the pipeline. Public Claude shares are viewable in a normal user browser, but automated fetches currently hit a Cloudflare bot challenge before any conversation data is available. That makes Claude support high-risk until a reliable fetch path is proven.

## What Is Already Reusable

These parts are already generic enough to reuse across providers:

- The normalized conversation model in `src/lib/types.ts`
- Markdown rendering in `src/lib/render.ts`
- The CLI and web flow conceptually converting a public conversation URL into Markdown

## Current ChatGPT-Specific Coupling

These areas would need refactoring before multi-provider support is clean:

- `src/lib/url.ts` only accepts `chat.openai.com` and `chatgpt.com` share URLs.
- `src/lib/share-cache.ts` derives cache keys from ChatGPT-only validation.
- `src/lib/extract.ts` looks for ChatGPT-style hydration payloads and `data-message-author-role` DOM markers.
- `src/lib/browser.ts` waits for ChatGPT-specific globals and DOM before extracting.
- UI and docs copy in `README.md`, `SPEC.md`, and `src/routes/index.tsx` assume ChatGPT-only support.

## Gemini Findings

Official Gemini help confirms:

- public chat links use the `g.co/gemini/share/...` format
- shared chats can be reshared
- most shared chats can be continued in a user's own Gemini session

Local validation against a real public Gemini link showed:

- `g.co/gemini/share/...` redirects to `https://gemini.google.com/share/...`
- the public page is fetchable server-side
- the returned HTML is a Google app shell with a `<chat-app>` root and provider-specific bootstrap data
- the current `extractConversationFromHtml()` implementation fails on that HTML because it does not contain the payload shapes or DOM markers expected by the ChatGPT extractor

Implication:

- Gemini support is likely a custom extractor project, not a minor extension of the existing ChatGPT heuristics
- the most likely implementation is a provider-specific browser/network extractor that reads post-hydration state or RPC responses, then maps the result into the existing normalized conversation model

Additional Gemini risk:

- in browser automation, Google may redirect some regions or user agents to a consent page before the share page loads, even when a direct HTTP fetch returns the share HTML
- that means Gemini support may need consent-page detection and a strategy for handling or avoiding that redirect in production

## Claude Findings

Official Claude help confirms:

- Claude supports public chat snapshots
- anyone with the link can view the shared snapshot
- shared chats can include artifacts

Local validation against a real public Claude share showed:

- direct HTTP fetch receives a Cloudflare challenge page instead of chat content
- Playwright also lands on the verification flow rather than the shared conversation
- this does not mean a human user cannot open the link in a normal browser; it means the blocker for `chatdump` is reliable automated access to the page

Implication:

- Claude support should be treated as transport-risky
- until the app can consistently retrieve the rendered shared page in automation, there is no stable extraction implementation to build on
- this is especially important for serverless deployment, where bot checks are often stricter and harder to work around

## Recommended Implementation Plan

1. Introduce a provider registry
   - Each provider should define URL matching, canonicalization, fetch policy, extraction strategy, and provider label metadata.

2. Generalize the entrypoints
   - Replace ChatGPT-only URL validation with provider detection.
   - Rename internals from `shareUrl` / `share page` semantics that imply a single provider.

3. Keep the normalized output model
   - Reuse `NormalizedConversation`, `NormalizedMessage`, and the Markdown renderer.

4. Add Gemini as the first non-OpenAI provider
   - Support `g.co/gemini/share/...` and `gemini.google.com/share/...`
   - Build a Gemini-specific extractor
   - Add fixtures from real public Gemini pages and expected normalized output
   - Update UI copy, CLI help, README, and tests

5. Treat Claude as a separate spike
   - First prove a reliable page retrieval path in automation
   - Only after that, design a Claude extractor

## Rough Effort

Assuming the goal is production-quality support rather than a fragile demo:

- Multi-provider refactor: 1-2 days
- Gemini support: 2-4 more days
- Claude transport spike: 1-3 days just to validate feasibility
- Claude full support after successful transport spike: 1-2 more days

If Claude transport remains blocked, the realistic outcome is:

- Gemini support ships
- Claude remains unsupported, or is supported only through a user-supplied export / HTML workflow rather than direct URL fetching

## Recommendation

- Proceed with a provider abstraction and Gemini first.
- Do not commit to Claude URL support until a reliable fetch path is demonstrated from the same runtime model used in production.
