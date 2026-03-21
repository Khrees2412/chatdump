import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { renderToString } from 'react-dom/server';
import { test, expect } from 'bun:test';

test('react-markdown renders tables with <br>', () => {
  const md = `| A | B |\n| --- | --- |\n| 1 | 2<br>3 |`;

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
