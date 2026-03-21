import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { renderToString } from 'react-dom/server';
import { test, expect } from 'bun:test';

test('react-markdown renders CRLF tables', () => {
  const md = `| A | B |\r\n| --- | --- |\r\n| 1 | 2 |`;

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
