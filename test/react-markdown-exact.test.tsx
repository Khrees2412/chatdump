import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { renderToString } from 'react-dom/server';
import { test, expect } from 'bun:test';

test('react-markdown renders the exact table from screenshot', () => {
  const md = `### Most popular naming conventions in Go

| Intended operation | Very common method name | Also seen                     | Example packages                |
|--------------------|-------------------------|-------------------------------|---------------------------------|
| \`+\`                | \`Add\`                   | \`Plus\`                        | \`big.Int\`, \`image.Point\`        |
| \`-\`                | \`Sub\`                   | \`Minus\`                       | \`big.Int\`, \`time.Duration\`      |
| \`*\` (scalar)       | \`Mul\`                   | \`Scale\`, \`Times\`              | \`big.Int\`, vector libraries     |
| \`/\`                | \`Div\`                   | \`Quo\` (quotient)              | \`big.Int\`, \`big.Rat\`            |
| \`==\`               | usually just use \`==\`   | \`Equal\`, \`Eq\`                 | (most types use built-in \`==\`)  |
| \`<\`, \`<=\` etc.     | \`Cmp\`, \`Compare\`        | \`Less\`, \`Before\`              | \`bytes.Compare\`, \`time.Time\`    |
| \`a + b\` style      | \`Add\` (receiver first)  | -                             | most math/geometry libraries    |

### When people really want operator syntax`;

  const element = React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeRaw, rehypeHighlight],
    components: {
      table: ({ node, ...props }) => React.createElement('div', { className: 'table-scroll-wrapper' }, 
        React.createElement('table', props)
      )
    }
  }, md);

  const html = renderToString(element);
  console.log('HTML GENERATED:\n' + html);
});
