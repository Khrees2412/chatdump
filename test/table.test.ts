import { test, expect } from 'bun:test';
import { renderConversationToMarkdown } from '../src/lib/render.ts';

test('table is rendered correctly', () => {
  const md = renderConversationToMarkdown({
    title: 'Test',
    sourceUrl: 'https://example.com',
    messages: [
      {
        role: 'assistant',
        blocks: [
          {
            kind: 'table',
            headers: ['A', 'B'],
            rows: [['1', '2\n3'], ['3', '4']]
          }
        ]
      }
    ]
  });
  console.log('MARKDOWN GENERATED:\n' + md);
  expect(md).toContain('| A | B |');
});
