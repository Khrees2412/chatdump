# chatdump

Convert a public share link into clean Markdown.

Live app: [https://chatdump.vercel.app](https://chatdump.vercel.app)

Paste a public share link, get back a readable Markdown transcript.
Current supported platforms: ChatGPT, Claude, Copilot, Gemini, and Grok.

It includes:

- a small web UI for paste-and-export
- a CLI for stdout or file output

## Requirements

- [Bun](https://bun.sh/)

## Quick Start

```bash
bun install
bun run dev
```

Open the local app, paste a public share link, and copy the generated Markdown.

## CLI

Basic usage:

```bash
bun run cli -- https://chatgpt.com/share/<id>
```

Write to a file:

```bash
bun run cli -- https://chatgpt.com/share/<id> -o conversation.md
```

Useful options:

- `-o, --output <path>`: write Markdown to a file
- `--stdout`: print Markdown even when writing to a file
- `--title <text>`: override the extracted title
- `--no-metadata`: omit the metadata header
- `-h, --help`: show help

## Supported URLs

- `https://chatgpt.com/share/<id>`
- `https://chat.openai.com/share/<id>`
- `https://copilot.microsoft.com/shares/<id>`
- `https://gemini.google.com/share/<id>`
- `https://g.co/gemini/share/<id>`
- `https://claude.ai/share/<id>`
- `https://grok.com/share/<id>`

Redirects between supported share domains are handled.

## Development

```bash
bun run dev
bun run test
bun run typecheck
```

## Private Provider Health

There is a private health endpoint at `/api/private/provider-health`.

It is disabled unless `CHATDUMP_HEALTH_TOKEN` is set. When the token is missing, the endpoint returns `404`.

Environment variables:

- `CHATDUMP_HEALTH_TOKEN`: bearer token required to access the endpoint
- `CHATDUMP_HEALTH_CHATGPT_URL`: public ChatGPT share URL used for the probe
- `CHATDUMP_HEALTH_GEMINI_URL`: public Gemini share URL used for the probe
- `CHATDUMP_HEALTH_CLAUDE_URL`: public Claude share URL used for the probe
- `CHATDUMP_HEALTH_COPILOT_URL`: public Copilot share URL used for the probe
- `CHATDUMP_HEALTH_GROK_URL`: public Grok share URL used for the probe
- `CHATDUMP_HEALTH_CACHE_TTL_MS`: optional in-memory probe cache TTL, defaults to 5 minutes

Example:

```bash
curl \
  -H "Authorization: Bearer $CHATDUMP_HEALTH_TOKEN" \
  "https://chatdump.vercel.app/api/private/provider-health?providers=chatgpt,claude,copilot,gemini,grok"
```

Useful query parameters:

- `providers=chatgpt,claude,copilot,gemini,grok`: limit the check to one or more providers
- `fresh=1`: bypass the short-lived health cache and run live probes

## Notes

- Only public share pages are supported.
- Extraction prefers embedded structured data and falls back to DOM/browser extraction when needed.
- Claude shares currently rely on browser fallback because direct server-side fetches can be challenged.
