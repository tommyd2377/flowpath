import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

// Also run in WebKit: its gradient-plus-shadow layer used to snap the entire wave.
test('animated waveform tails stay anchored on a high-density mobile screen', async ({ page }) => {
  // This rendering check never needs news, a microphone, or a model request.
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('https://api.openai.com/**', route => route.abort('blockedbyclient'));
  await page.goto('/');
  // News recovery notices now fade away; measure canvas stability after that
  // intentional status/dock transition, rather than treating it as jitter.
  await expect(page.locator('.conversation-copy')).toHaveCSS('opacity', '0', { timeout: 8_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context || document.getAnimations().some(animation => animation.playState === 'running')) return false;
    // The server-rendered canvas has nonzero default dimensions before hydration paints it.
    return context.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height).data
      .some((value, index) => index % 4 === 3 && value > 0);
  });

  const result = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!;
    const context = canvas.getContext('2d')!;
    const initialBounds = canvas.getBoundingClientRect();
    const scaleY = canvas.height / initialBounds.height;
    const centerSignatures = new Set<number>();
    let previous: number[] | null = null;
    let maxTailStep = 0;
    let maxLayoutShift = 0;
    let minTailAlpha = Infinity;

    for (let frame = 0; frame < 360; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const bounds = canvas.getBoundingClientRect();
      maxLayoutShift = Math.max(maxLayoutShift, Math.abs(bounds.top - initialBounds.top),
        Math.abs(bounds.height - initialBounds.height));
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const tails = [0.07, 0.93].map(progress => {
        const centerX = Math.round(image.width * progress);
        let alpha = 0;
        let weightedY = 0;
        for (let x = centerX - 4; x <= centerX + 4; x++) {
          for (let y = Math.floor(image.height / 2) - 12; y < Math.ceil(image.height / 2) + 12; y++) {
            const value = image.data[(y * image.width + x) * 4 + 3];
            alpha += value;
            weightedY += value * (y + 0.5);
          }
        }
        minTailAlpha = Math.min(minTailAlpha, alpha);
        return weightedY / alpha / scaleY;
      });
      if (previous) {
        maxTailStep = Math.max(maxTailStep, ...tails.map((y, i) => Math.abs(y - previous![i])));
      }
      previous = tails;
      let signature = 0;
      const centerX = Math.floor(image.width / 2);
      for (let y = 0; y < image.height; y++) {
        signature = Math.imul(signature ^ image.data[(y * image.width + centerX) * 4 + 3], 16777619);
      }
      centerSignatures.add(signature);
    }
    return { maxTailStep, maxLayoutShift, minTailAlpha, changingCenterFrames: centerSignatures.size };
  });

  expect(result.minTailAlpha).toBeGreaterThan(0);
  expect(result.maxLayoutShift).toBeLessThan(0.01);
  expect(result.changingCenterFrames).toBeGreaterThan(60);
  expect(result.maxTailStep).toBeLessThan(0.2);
});
