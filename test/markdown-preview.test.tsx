import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { renderToString } from 'react-dom/server';
import { expect, test } from 'bun:test';
import { splitMarkdownForPreview } from '../src/lib/markdown-preview';

test('splitMarkdownForPreview detects indented pipe tables', () => {
  const input = `### Title

  | A | B |
  | --- | --- |
  | 1 | 2 |

\`\`\`js
const keep = 'fence';
\`\`\`
`;

  const segments = splitMarkdownForPreview(input);

  expect(segments.some((segment) => segment.kind === 'table')).toBe(true);
  expect(segments.some((segment) => segment.kind === 'markdown')).toBe(true);
});

test('preview split renders tables, lists, and fenced code', () => {
  const segments = splitMarkdownForPreview(`Most popular naming conventions in Go

  - first item
  - second item

  | Intended operation | Very common method name | Also seen | Example packages |
  | --- | --- | --- | --- |
  | \`+\` | \`Add\` | \`Plus\` | \`big.Int\`, \`image.Point\` |

\`\`\`js
const keep = 'fence';
\`\`\`
`);

  const html = renderToString(
    React.createElement(
      React.Fragment,
      null,
      ...segments.map((segment, index) => {
        if (segment.kind === 'table') {
          return React.createElement(
            'div',
            { className: 'table-scroll-wrapper', key: `table-${index}` },
            React.createElement(
              'table',
              null,
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  ...segment.headers.map((cell) =>
                    React.createElement('th', null, cell),
                  ),
                ),
              ),
              React.createElement(
                'tbody',
                null,
                ...segment.rows.map((row) =>
                  React.createElement(
                    'tr',
                    null,
                    ...segment.headers.map((_, cellIndex) =>
                      React.createElement('td', null, row[cellIndex] ?? ''),
                    ),
                  ),
                ),
              ),
            ),
          )
        }

        return React.createElement(ReactMarkdown, {
          key: `markdown-${index}`,
          remarkPlugins: [remarkGfm],
          rehypePlugins: [rehypeRaw, rehypeHighlight],
        }, segment.content)
      }),
    ),
  );

  expect(html).toContain('table-scroll-wrapper');
  expect(html).toContain('<th>Intended operation</th>');
  expect(html).toContain('first item');
  expect(html).toContain('language-js');
  expect(html).toContain('const');
});
