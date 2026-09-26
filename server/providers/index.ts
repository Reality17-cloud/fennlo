import type { GenerativeProvider } from '../../src/shared/spec.js';
import { MockGenerativeProvider } from './mock.js';
import { hasUsableCredential, OpenAIGenerativeProvider } from './openai.js';
import { GeminiGenerativeProvider } from './gemini.js';
import { DevelopmentGenerativeProvider } from './development.js';

export { MockGenerativeProvider } from './mock.js';
export { OpenAIGenerativeProvider, ProviderError } from './openai.js';
export function createProvider(env: NodeJS.ProcessEnv = process.env): GenerativeProvider {
  if (env.FENNLO_PROVIDER === 'mock') return new MockGenerativeProvider();
  if (env.FENNLO_PROVIDER === 'openai-legacy' && hasUsableCredential(env.OPENAI_API_KEY)) return new OpenAIGenerativeProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || 'gpt-4.1-mini');
  if (env.FENNLO_PROVIDER !== 'development' && env.GEMINI_API_KEY?.trim()) return new GeminiGenerativeProvider(env.GEMINI_API_KEY, {
    model: env.GEMINI_MODEL || undefined, imageSize: env.GEMINI_IMAGE_SIZE || undefined, aspectRatio: env.GEMINI_ASPECT_RATIO || undefined,
    maxPoints: env.FENNLO_MAX_POINTS ? Number(env.FENNLO_MAX_POINTS) : undefined,
  });
  return new DevelopmentGenerativeProvider();
}
