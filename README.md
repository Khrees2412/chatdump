# chatdump

Convert a public share link into clean Markdown.

Live app: `https://chatdump.vercel.app`

Paste a public share link, get back a readable Markdown transcript.

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
- `https://gemini.google.com/share/<id>`
- `https://g.co/gemini/share/<id>`
- `https://claude.ai/share/<id>`

Redirects between supported share domains are handled.

## Development

```bash
bun run dev
bun run test
bun run typecheck
```

## Notes

- Only public share pages are supported.
- Extraction prefers embedded structured data and falls back to DOM/browser extraction when needed.
- Claude shares currently rely on browser fallback because direct server-side fetches can be challenged.
