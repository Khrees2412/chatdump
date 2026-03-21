# chatdump Specification

## 1. Purpose

`chatdump` converts the content of a public share URL into a clean,
deterministic Markdown document.

The tool exists to make shared conversations portable, readable in
plain text, easy to version-control, and suitable for downstream processing.
The current provider set covers ChatGPT, Claude, Copilot, Gemini,
and Grok public share URLs.

## 2. Goal

Given a supported public share URL, `chatdump` must:

1. Fetch the shared conversation content.
2. Extract the conversation structure and available metadata.
3. Render that conversation as Markdown with stable formatting.
4. Return the Markdown to stdout or write it to a file.

## 3. Non-Goals

`chatdump` does not need to:

1. Access private or authenticated conversations.
2. Reconstruct every visual detail of the original chat UI.
3. Preserve hidden internal metadata that is not visible in the shared page.
4. Support editing, replaying, or re-uploading the conversation.
5. Convert arbitrary web pages; the input is specifically a public share URL.

## 4. Supported Inputs

### 4.1 URL formats

Initial support targets public share URLs in canonical forms such as:

- `https://chatgpt.com/share/<id>`
- `https://chat.openai.com/share/<id>`
- `https://copilot.microsoft.com/shares/<id>`
- `https://gemini.google.com/share/<id>`
- `https://g.co/gemini/share/<id>`
- `https://claude.ai/share/<id>`
- `https://grok.com/share/<id>`

The implementation should also tolerate redirects between supported
share domains.

### 4.2 Input contract

The tool accepts exactly one share URL per invocation in the first version.

If the URL is not a supported public share URL, the tool must fail with a
clear error.

## 5. Output Contract

### 5.1 Primary output

The output is a UTF-8 Markdown document.

The Markdown must be:

- readable as plain text
- deterministic for the same source content
- valid enough to render correctly on common Markdown renderers
- free of page chrome, scripts, and unrelated HTML

### 5.2 Default document structure

The rendered document must follow this structure:

```md
# <title>

Source: <share-url>
Exported: <ISO-8601 timestamp>

## User

<message content>

## Assistant

<message content>
```

Optional metadata may be added if available, but the message order and message
content are the core output.

### 5.3 Stable formatting rules

The renderer must:

1. Preserve conversation order exactly.
2. Use Unix newlines (`\n`).
3. Use a single blank line between paragraphs and sections.
4. Avoid trailing whitespace.
5. Produce the same Markdown for the same extracted conversation data.

## 6. Functional Requirements

### 6.1 Fetching

The tool must:

1. Perform an HTTP GET for the share URL.
2. Follow normal redirects.
3. Reject non-2xx final responses with a useful error.
4. Fail clearly if the page is unavailable, deleted, or malformed.

### 6.2 Extraction

The extractor must prefer structured conversation data embedded in the share
page over scraping rendered text from the visible DOM.

Preferred extraction order:

1. Embedded JSON containing conversation/message data.
2. Structured page data exposed through script tags or framework payloads.
3. Rendered DOM fallback, only if structured data is unavailable.

The implementation should isolate extraction from rendering so future changes
to the share page format only affect one layer.

### 6.3 Normalized conversation model

Before rendering, the fetched content must be normalized into:

- `source_url`
- `title`
- `conversation_id` if available
- ordered `messages`

Each message should normalize to:

- `role`: `system`, `user`, `assistant`, or `unknown`
- `author_name` if available
- `created_at` if available
- `blocks`: ordered content blocks

Each content block should normalize to one of:

- `text`
- `code`
- `quote`
- `list`
- `table`
- `image`
- `file`
- `unknown`

Unknown blocks must degrade gracefully to plain text or a descriptive placeholder.

## 7. Markdown Rendering Rules

### 7.1 Message sections

Each message must render as its own second-level heading:

- `## System`
- `## User`
- `## Assistant`
- `## Unknown`

If the source exposes a more specific author label, it may be appended:

```md
## Assistant (GPT-4o)
```

### 7.2 Text

Plain text blocks must render as paragraphs with paragraph breaks preserved.

Inline formatting should be preserved when it can be represented safely in
Markdown, including:

- links
- emphasis
- strong emphasis
- inline code

### 7.3 Code

Code blocks must use fenced code blocks.

If a language is known, include it after the opening fence:

````md
```python
print("hello")
```
````

Inline code must use backticks.

### 7.4 Lists

Ordered and unordered lists must render as Markdown lists when the source
structure is recoverable.

If list nesting cannot be recovered confidently, flatten to readable plain text
instead of generating broken Markdown.

### 7.5 Quotes

Quoted content must render using Markdown blockquote syntax.

### 7.6 Tables

Tables should render as Markdown tables when the source data is rectangular and
header inference is reliable.

If not, render the content as plain text with row separation rather than emit a
broken table.

### 7.7 Links

Links must preserve destination URLs.

If link text is unavailable, render the raw URL.

### 7.8 Images and files

If the share payload exposes attachments, render them as links:

```md
[Attachment: file.pdf](https://...)
![Image: diagram](https://...)
```

If only a filename exists and no stable URL is available, render a placeholder:

```md
[Attachment: file.pdf]
```

### 7.9 Rich or unsupported blocks

If a block type cannot be faithfully represented, the renderer must prefer a
readable fallback over omission.

Example:

```md
[Unsupported content block: interactive widget]
```

## 8. Metadata Rules

If available, the document should include:

- title
- source URL
- export timestamp
- conversation creation timestamp
- model/author labels exposed by the source

Metadata that is speculative or inferred from CSS/UI text must not be emitted
as authoritative unless the source payload clearly provides it.

## 9. Error Handling

The tool must fail explicitly for these cases:

1. Invalid URL syntax.
2. Unsupported domain or path.
3. Share page returns `404`, `410`, or similar unavailable status.
4. Share page loads but conversation data cannot be extracted.
5. Network timeout or connection failure.

Errors must:

- be printed to stderr
- be concise and actionable
- not include large HTML dumps

Example errors:

- `unsupported share URL: expected a public share link`
- `failed to fetch share page: HTTP 404`
- `could not extract conversation data from share page`

## 10. CLI Scope

The first implementation should be CLI-first.

Minimum interface:

```sh
chatdump <share-url>
```

Recommended options:

- `-o, --output <path>`: write Markdown to a file
- `--stdout`: force stdout output
- `--title <text>`: override extracted title
- `--no-metadata`: omit metadata header

Default behavior:

- print Markdown to stdout if no output path is provided
- return non-zero exit code on failure

## 11. Security and Privacy

1. `chatdump` must only fetch the provided URL and required redirects.
2. The tool must not execute page scripts.
3. The tool must treat extracted HTML as untrusted input.
4. The renderer must not emit executable page content by default.
5. The tool must not require user authentication for supported cases.

## 12. Implementation Constraints

1. Extraction logic must be separate from Markdown rendering logic.
2. The normalized conversation model must be testable without live network access.
3. Rendering must be deterministic from the normalized model alone.
4. Network tests and rendering tests should be separable.

## 13. Acceptance Criteria

`chatdump` is complete for v1 when all of the following are true:

1. A valid public share URL produces a readable Markdown transcript.
2. User and assistant turns appear in the correct order.
3. Code blocks remain fenced and readable.
4. Links remain intact.
5. Missing or unsupported rich content degrades gracefully.
6. Invalid or unavailable URLs fail with clear errors.
7. Re-running the tool on unchanged source content produces byte-stable output,
   except for the export timestamp if included.

## 14. Suggested Test Cases

The implementation should include fixtures for:

1. A simple user/assistant exchange with plain paragraphs.
2. A conversation containing fenced code blocks with language tags.
3. A conversation containing links, lists, and blockquotes.
4. A conversation containing tables or pseudo-tables.
5. A conversation containing image or file attachments.
6. A deleted or unavailable share URL.
7. A valid share page whose structure changes enough to break one extractor
   path, proving fallback behavior.

## 15. Out of Scope for v1

These can be deferred:

1. Batch conversion of multiple URLs.
2. Front matter export formats such as YAML or JSON sidecars.
3. Alternate outputs such as HTML, PDF, or JSON.
4. Automatic filename generation from conversation title.
5. Full fidelity export of every provider-specific UI artifact.
