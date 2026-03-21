import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');

  // We need to inject the markdown state or type it into the form.
  // Wait, there is a Form to paste a URL. Is there a way to paste raw markdown?
  // The user said "the markdown shows raw". The app has a LocalStorage? SessionStorage?
  // The state is persisted in sessionStorage with key 'chatdump.home-state.v1'
  await page.evaluate(() => {
    const rawMd = `### Most popular naming conventions in Go

| Intended operation | Very common method name | Also seen                     | Example packages                |
|--------------------|-------------------------|-------------------------------|---------------------------------|
| \`+\`                | \`Add\`                   | \`Plus\`                        | \`big.Int\`, \`image.Point\`        |
| \`-\`                | \`Sub\`                   | \`Minus\`                       | \`big.Int\`, \`time.Duration\`      |

### When people really want operator syntax`;

    window.sessionStorage.setItem('chatdump.home-state.v1', JSON.stringify({
      markdown: rawMd,
      outputMode: 'preview',
      url: 'https://example.com/share',
      warnings: []
    }));
  });

  // Reload to hydrate state
  await page.reload();

  // Wait for React to render
  await page.waitForTimeout(1000);

  // Read the markdown-preview article
  const articleHtml = await page.evaluate(() => {
    const preview = document.querySelector('article.markdown-preview');
    return preview ? preview.innerHTML : null;
  });

  console.log('--- PREVIEW HTML INNER STR ---');
  console.log(articleHtml);

  await browser.close();
})();
