import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createApplication } from '../../server/application/index';
import { MockGenerativeProvider } from '../../server/providers/mock';
import type { Experience, ExperienceSpec } from '../../src/shared/spec';

async function openReference(page: Page, intent: string) {
  const response = await page.request.post('/api/experiences', { data: { intent, reference: true } });
  expect(response.ok()).toBeTruthy();
  const { experience } = await response.json() as { experience: Experience };
  expect(experience.provider).toBe('mock');
  await page.goto(`/?experience=${experience.id}`);
  return experience;
}

test('the retained seasons reference persists with an accessible transcript', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openReference(page, 'Explain why seasons happen.');
  await expect(page.locator('[data-renderer="scene2d"]')).toBeVisible();
  await expect(page.getByText('A little tilt.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(/experience=/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/seasons-desktop.png' });
  await page.getByRole('button', { name: 'Read explanation' }).click();
  await expect(page.getByRole('dialog')).toContainText('not the cause of the seasons');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('[data-renderer="scene2d"]')).toBeVisible();
  await expect(page.locator('.welcome-copy')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause motion' }).click();
  await expect(page.getByRole('button', { name: 'Resume motion' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('retained acceleration and poetry references use materially different compositions', async ({ page }) => {
  await openReference(page, 'Explain acceleration visually.');
  await expect(page.locator('.palette-paper.is-experiencing')).toBeVisible();
  await expect(page.getByText('Speed is a moment.', { exact: false })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/acceleration-desktop.png' });
  await openReference(page, 'Explain a short poem in the most natural way.');
  await expect(page.locator('.palette-dusk.is-experiencing')).toBeVisible();
  await expect(page.getByText('I set a small stone in the stream.', { exact: false }).first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/poem-desktop.png' });
  await page.getByRole('button', { name: 'Read explanation' }).click();
  await expect(page.getByRole('dialog')).toContainText('One reading:');
});

test('text, image, audio, video, and structured scenes load from the artifact substrate', async ({ page, request }) => {
  await page.goto('/');
  const response = await page.request.post('/api/experiences', { data: { intent: 'Explain seasons.', reference: true } });
  expect(response.ok()).toBeTruthy();
  const { experience } = await response.json() as { experience: Experience };
  const application = createApplication({ databasePath: resolve('data/browser-test/fennlo.sqlite'), storageDirectory: resolve('data/browser-test/artifacts'), provider: new MockGenerativeProvider() });
  const media: ExperienceSpec = { version: 1, title: 'Media substrate check', composition: 'editorial', palette: 'cosmos', summary: 'Locally stored text, image, audio, video and structured scene render through one registry.', nodes: [
    { id: 'bg', renderer: 'backdrop', slot: 'background', payload: { palette: 'cosmos', grain: true }, startMs: 0 },
    { id: 'text', renderer: 'text', slot: 'title', payload: { role: 'title', text: 'Media substrate check' }, startMs: 0 },
    { id: 'image', renderer: 'image', slot: 'hero', payload: { artifactId: 'reference-image', alt: 'Locally generated atmospheric gradient', fit: 'contain' }, startMs: 0 },
    { id: 'audio', renderer: 'audio', slot: 'overlay', payload: { artifactId: 'reference-audio', transcript: 'A quiet synthesized ambient tone.' }, startMs: 0 },
    { id: 'video', renderer: 'video', slot: 'aside', payload: { artifactId: 'reference-video', caption: 'A moving atmospheric gradient.', loop: true }, startMs: 0 },
    { id: 'scene', renderer: 'scene2d', slot: 'background', payload: { kind: 'ripples', lines: ['Ambient motion'] }, startMs: 0 },
  ] };
  const created = application.experience.create(experience.visitorSessionId, 'Verify media rendering');
  application.experience.complete(created.id, media);
  application.close();
  await page.goto(`/?experience=${created.id}`);
  await expect(page.getByAltText('Locally generated atmospheric gradient')).toBeVisible();
  await expect.poll(() => page.getByAltText('Locally generated atmospheric gradient').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
  const range = await request.get('/api/artifacts/reference-video', { headers: { Range: 'bytes=0-31' } });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(32);
  const text = await request.get('/api/artifacts/reference-text');
  expect(await text.text()).toContain('23.4');
  await page.getByRole('button', { name: 'Enable narration' }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole('button', { name: 'Mute narration' }).click();
});

test('retained references keep their scene, text and keyboard input with mobile reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openReference(page, 'Explain why seasons happen.');
  await expect(page.locator('[data-renderer="scene2d"]')).toBeVisible();
  await expect(page.getByLabel('What would you like to understand?')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/seasons-mobile.png' });
  await page.getByRole('button', { name: 'Read explanation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
