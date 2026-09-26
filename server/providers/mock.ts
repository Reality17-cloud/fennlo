import { createIntentSchema, type GenerationContext, type GenerativeProvider, type ExperienceSpec } from '../../src/shared/spec.js';
import { referenceForIntent } from './references.js';

/** Deliberately deterministic, honestly authored: no simulated live AI or network calls. */
export class MockGenerativeProvider implements GenerativeProvider {
  readonly name = 'mock';
  async generate(context: GenerationContext): Promise<ExperienceSpec> {
    const { intent } = createIntentSchema.parse({ intent: context.intent });
    return referenceForIntent(intent);
  }
}
