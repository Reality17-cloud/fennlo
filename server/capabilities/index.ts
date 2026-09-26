import { randomUUID } from 'node:crypto';
import { validateGeneratedExplanation } from '../domain/generated-explanation.js';
import type { GeneratedExplanation } from '../../src/shared/spec.js';
import { z } from 'zod';
import { experienceSpecSchema, idSchema, nodeSchema, rendererPayloadSchemas, type Artifact, type CapabilityDescriptor, type Experience, type ExperienceNode, type ExperienceSpec, type GenerativeProvider, type RendererName } from '../../src/shared/spec.js';

const representationInput = <T extends z.ZodTypeAny>(payload: T) => z.object({ id: idSchema.optional(), slot: z.enum(['background', 'hero', 'title', 'body', 'aside', 'overlay']).optional(), startMs: z.number().int().min(0).max(60000).optional(), payload }).strict();
const checkedNodeSchema = nodeSchema.superRefine((node, context) => {
  const schema = Object.hasOwn(rendererPayloadSchemas, node.renderer) ? rendererPayloadSchemas[node.renderer as RendererName] : undefined;
  if (!schema || !schema.safeParse(node.payload).success) context.addIssue({ code: 'custom', message: 'Invalid renderer or payload' });
});
const unavailableGenerationInput = z.object({ prompt: z.string().trim().min(1).max(2000) }).strict();
export const capabilityInputs = {
  'artifact.read': z.object({ id: idSchema }).strict(),
  'artifact.store': z.object({ contentType: z.string().regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).max(150), dataBase64: z.string().max(11_184_812).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), metadata: z.record(z.unknown()).optional(), provenance: z.record(z.unknown()).optional() }).strict(),
  'artifact.query': z.object({ contentType: z.string().max(150).optional(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  'experience.emit': z.object({ experienceId: idSchema, node: checkedNodeSchema }).strict(),
  'representation.text': representationInput(rendererPayloadSchemas.text),
  'representation.image': representationInput(rendererPayloadSchemas.image),
  'representation.audio': representationInput(rendererPayloadSchemas.audio),
  'representation.video': representationInput(rendererPayloadSchemas.video),
  'representation.scene2d': representationInput(rendererPayloadSchemas.scene2d),
  'representation.backdrop': representationInput(rendererPayloadSchemas.backdrop),
  'representation.presenter': representationInput(rendererPayloadSchemas.presenter),
  'representation.explanation-point': representationInput(rendererPayloadSchemas['explanation-point']),
  'generation.language': z.object({ intent: z.string().trim().min(1).max(2000) }).strict(),
  'generation.explanation': z.object({ intent: z.string().trim().min(1).max(2000) }).strict(),
  'generation.image': unavailableGenerationInput,
  'generation.audio': unavailableGenerationInput,
  'generation.video': unavailableGenerationInput,
};
export type CapabilityName = keyof typeof capabilityInputs;
export type CapabilityInputs = { [K in CapabilityName]: z.input<(typeof capabilityInputs)[K]> };
type RepresentationName = Extract<CapabilityName, `representation.${string}`>;
export type CapabilityOutputs = {
  'artifact.read': Artifact | null | undefined;
  'artifact.store': Artifact;
  'artifact.query': Artifact[];
  'experience.emit': Experience;
  'generation.language': ExperienceSpec;
  'generation.explanation': GeneratedExplanation;
  'generation.image': never;
  'generation.audio': never;
  'generation.video': never;
} & { [K in RepresentationName]: ExperienceNode };

type MaybePromise<T> = T | Promise<T>;
export interface CapabilityDependencies {
  provider: GenerativeProvider;
  artifactRead(id: string): MaybePromise<Artifact | null | undefined>;
  artifactStore(input: z.infer<typeof capabilityInputs['artifact.store']>): MaybePromise<Artifact>;
  artifactQuery(input: z.infer<typeof capabilityInputs['artifact.query']>): MaybePromise<Artifact[]>;
  experienceEmit(experienceId: string, node: ExperienceNode): MaybePromise<Experience>;
}
interface CapabilityEntry { descriptor: CapabilityDescriptor; run(input: unknown): Promise<unknown> }
export class CapabilityError extends Error {
  constructor(readonly code: 'UNKNOWN' | 'UNAVAILABLE' | 'INVALID_INPUT', message: string) { super(message); this.name = 'CapabilityError'; }
}

/** Internal application API. Mutation capabilities are deliberately not public visitor routes. */
export class CapabilityRegistry {
  private readonly entries = new Map<CapabilityName, CapabilityEntry>();

  register<K extends CapabilityName>(name: K, description: string, run: (input: z.output<(typeof capabilityInputs)[K]>) => MaybePromise<CapabilityOutputs[K]>, options: { available?: boolean; requiresProvider?: boolean } = {}): void {
    if (this.entries.has(name)) throw new Error(`Capability already registered: ${name}`);
    this.entries.set(name, {
      descriptor: { name, description, available: options.available ?? true, requiresProvider: options.requiresProvider ?? false },
      run: async (input: unknown) => {
        const parsed = capabilityInputs[name].safeParse(input);
        if (!parsed.success) throw new CapabilityError('INVALID_INPUT', `Invalid input for ${name}.`);
        return run(parsed.data as z.output<(typeof capabilityInputs)[K]>);
      },
    });
  }

  list(): CapabilityDescriptor[] { return [...this.entries.values()].map(({ descriptor }) => ({ ...descriptor })); }
  execute<K extends CapabilityName>(name: K, input: CapabilityInputs[K]): Promise<CapabilityOutputs[K]>;
  execute(name: string, input: unknown): Promise<unknown>;
  async execute(name: string, input: unknown): Promise<unknown> {
    const entry = this.entries.get(name as CapabilityName);
    if (!entry) throw new CapabilityError('UNKNOWN', 'This capability is not registered.');
    if (!entry.descriptor.available) throw new CapabilityError('UNAVAILABLE', 'This capability requires a provider that is not connected.');
    return entry.run(input);
  }
}

export function createCapabilityRegistry(dependencies: CapabilityDependencies): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register('artifact.read', 'Read metadata for a digital artifact.', input => dependencies.artifactRead(input.id));
  registry.register('artifact.store', 'Store artifact bytes and generic resource metadata.', input => dependencies.artifactStore(input));
  registry.register('artifact.query', 'Find artifacts by content type.', input => dependencies.artifactQuery(input));
  registry.register('experience.emit', 'Append one validated declarative node to a pending experience.', input => dependencies.experienceEmit(input.experienceId, input.node));
  const representations: RendererName[] = ['text', 'image', 'audio', 'video', 'scene2d', 'backdrop', 'presenter', 'explanation-point'];
  for (const renderer of representations) {
    registry.register(`representation.${renderer}`, `Create a validated ${renderer} presentation node.`, input => ({
      id: input.id ?? randomUUID(), renderer, slot: input.slot ?? (renderer === 'backdrop' ? 'background' : 'hero'), startMs: input.startMs ?? 0, payload: input.payload,
    }));
  }
  const nativeExplanation = ['gemini', 'development'].includes(dependencies.provider.name);
  registry.register('generation.language', dependencies.provider.name === 'mock' ? 'Compose a deterministic authored reference experience; open-ended live generation is unavailable.' : 'Legacy text-only composition capability.', async ({ intent }) => {
    const spec = await dependencies.provider.generate({ intent, capabilities: registry.list(), artifacts: await dependencies.artifactQuery({ limit: 50 }) });
    return experienceSpecSchema.parse(spec);
  }, { available: !nativeExplanation, requiresProvider: dependencies.provider.name !== 'mock' });
  registry.register('generation.explanation', dependencies.provider.name === 'development' ? 'Create development text and explicitly non-generated placeholder artifacts.' : 'Generate concise text and matching native images in one Gemini request.', async ({ intent }) => {
    return validateGeneratedExplanation(await dependencies.provider.generate({ intent, capabilities: registry.list(), artifacts: [] }));
  }, { available: nativeExplanation, requiresProvider: dependencies.provider.name === 'gemini' });
  for (const kind of ['image', 'audio', 'video'] as const) {
    registry.register(`generation.${kind}`, `Generate new ${kind} artifacts with an external provider.`, () => { throw new CapabilityError('UNAVAILABLE', 'No media generation provider is connected.'); }, { available: false, requiresProvider: true });
  }
  return registry;
}
