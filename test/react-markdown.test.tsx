import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { renderToString } from 'react-dom/server';
import { test, expect } from 'bun:test';

test('react-markdown renders table without newline before', () => {
  const md = `Most popular naming conventions in Go\n| Intended operation | Very common method name | Also seen | Example packages |\n| --- | --- | --- | --- |\n| + | Add | Plus | big.Int, image.Point |\n| - | Sub | Minus | big.Int, time.Duration |`;

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
