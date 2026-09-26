import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApplication } from '../../server/application/index';
import { MockGenerativeProvider } from '../../server/providers/mock';
import type { Experience } from '../../src/shared/spec';

async function submitIntent(page: Page, intent: string): Promise<Experience> {
  const input = page.getByLabel('What would you like to understand?');
  await expect(input).toBeEnabled();
  await input.fill(intent);
  const pendingResponse = page.waitForResponse(response => response.url().endsWith('/api/experiences') && response.request().method() === 'POST');
  await input.press('Enter');
  const response = await pendingResponse;
  expect(response.ok()).toBeTruthy();
  const { experience } = await response.json() as { experience: Experience };
  expect(experience.intent).toBe(intent);
  expect(experience.status).toBe('complete');
  expect(experience.provider).toBe('development');
  expect(experience.spec?.composition).toBe('explanation');
  expect(experience.spec?.nodes.length).toBeGreaterThan(0);
  for (const node of experience.spec?.nodes ?? []) {
    expect(node.renderer).toBe('explanation-point');
    expect(node.payload.development).toBe(true);
    expect(typeof node.payload.title).toBe('string');
    expect(typeof node.payload.text).toBe('string');
    expect(typeof node.payload.artifactId).toBe('string');
    expect(String(node.payload.artifactId)).not.toMatch(/^reference-/);
  }
  await expect(page).toHaveURL(new RegExp(`experience=${experience.id}`));
  await expect(page.locator('.explanation-view')).toBeVisible();
  await expect(page.getByText('Development preview', { exact: true })).toBeVisible();
  await expect(page.locator('[data-renderer="explanation-point"]')).toHaveCount(experience.spec?.nodes.length ?? 0);
  await expect(page.locator('[data-renderer="scene2d"], audio, video')).toHaveCount(0);
  const image = page.locator('[data-renderer="explanation-point"] img');
  await expect(image).toHaveCount(experience.spec?.nodes.length ?? 0);
  await expect(image.first()).toBeVisible();
  await expect.poll(() => image.evaluateAll(elements => elements.every(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
  return experience;
}

test('seasons, CPU and DNA use the same visual explanation path with honest development disclosure', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
  await expect(page.locator('.reference-prompts')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/visual-v0-welcome-desktop.png' });
  const questions = [
    ['seasons', 'Explain why seasons happen.'],
    ['cpu', 'How does a CPU execute an instruction?'],
    ['dna', 'How does DNA replication work?'],
  ];
  const ids: string[] = [];
  const artifacts: string[] = [];
  for (const [label, intent] of questions) {
    const experience = await submitIntent(page, intent);
    ids.push(experience.id);
    const nodes = experience.spec!.nodes;
    artifacts.push(...nodes.map(node => String(node.payload.artifactId)));
    for (const node of nodes) await expect(page.locator('.explanation-view')).toContainText(String(node.payload.text));
    await expect(page.getByRole('button', { name: 'Next point', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.screenshot({ path: `test-results/visual-v0-${label}-desktop.png` });
    await page.reload();
    await expect(page.locator('.explanation-view')).toBeVisible();
    await expect(page.getByText('Development preview', { exact: true })).toBeVisible();
    for (const node of nodes) await expect(page.locator('.explanation-view')).toContainText(String(node.payload.text));
    const restored = await page.request.get(`/api/experiences/${experience.id}`);
    expect(restored.ok()).toBeTruthy();
    expect((await restored.json() as { experience: Experience }).experience.spec).toEqual(experience.spec);
  }
  expect(new Set(ids).size).toBe(3);

  // Verify the browser's images are real stored resources, without claiming that a model generated them.
  const application = createApplication({ databasePath: resolve('data/browser-test/fennlo.sqlite'), storageDirectory: resolve('data/browser-test/artifacts'), provider: new MockGenerativeProvider() });
  try {
    for (const id of new Set(artifacts)) {
      const artifact = application.artifact.get(id);
      expect(artifact.contentType).toMatch(/^image\//);
      const bytes = await readFile(resolve('data/browser-test/artifacts', artifact.storageKey));
      expect(bytes.byteLength).toBe(artifact.byteLength);
      expect(bytes.byteLength).toBeGreaterThan(0);
      const delivered = await page.request.get(`/api/artifacts/${id}`);
      expect(delivered.ok()).toBeTruthy();
      expect((await delivered.body()).byteLength).toBe(bytes.byteLength);
    }
  } finally { application.close(); }
  expect(errors).toEqual([]);
});

test('unsupported saved output and failed images degrade safely', async ({ page }) => {
  await page.goto('/');
  const experience = await submitIntent(page, 'How does a CPU execute an instruction?');
  await page.route('**/api/artifacts/**', route => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await expect(page.locator('.explanation-visual').first()).toContainText('This visual could not be loaded.');
  await expect(page.locator('.explanation-view')).toContainText(String(experience.spec!.nodes[0].payload.text));
  await page.unroute('**/api/artifacts/**');
  const corrupt = structuredClone(experience);
  corrupt.spec!.nodes[0].renderer = 'future-unknown-renderer';
  await page.route(`**/api/experiences/${experience.id}`, route => route.fulfill({ json: { experience: corrupt } }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('This saved explanation could not be read.');
  await expect(page.getByLabel('What would you like to understand?')).toBeEnabled();
});

test('the generic explanation stays readable and usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const experience = await submitIntent(page, 'How does DNA replication work?');
  await expect(page.locator('.explanation-view')).toContainText(String(experience.spec!.nodes[0].payload.text));
  const text = page.locator('.explanation-point-text').first();
  await text.scrollIntoViewIfNeeded();
  const metrics = await text.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { fontSize: Number.parseFloat(getComputedStyle(element).fontSize), left: bounds.left, right: bounds.right, width: bounds.width };
  });
  expect(metrics.fontSize).toBeGreaterThanOrEqual(15);
  expect(metrics.width).toBeGreaterThan(250);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const node of experience.spec!.nodes) await expect(page.locator('.explanation-view')).toContainText(String(node.payload.text));
  await expect(page.getByRole('button', { name: 'Next point', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/visual-v0-dna-mobile.png', fullPage: true });
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
});
