import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const sceneSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('seasons'), tilt: z.number().min(0).max(45), labels: z.array(z.string().max(120)).max(8) }).strict(),
  z.object({ kind: z.literal('acceleration'), acceleration: z.number().min(0.1).max(10), duration: z.number().min(2).max(30) }).strict(),
  z.object({ kind: z.literal('ripples'), lines: z.array(z.string().max(300)).min(1).max(8) }).strict(),
]);
export const rendererPayloadSchemas = {
  'explanation-point': z.object({ title: z.string().min(1).max(140), text: z.string().min(1).max(1200), artifactId: idSchema, alt: z.string().min(1).max(700), development: z.boolean().default(false) }).strict(),
  backdrop: z.object({ palette: z.enum(['cosmos', 'paper', 'dusk']), grain: z.boolean().default(true) }).strict(),
  text: z.object({ text: z.string().min(1).max(6000), role: z.enum(['eyebrow', 'title', 'body', 'caption', 'verse']), emphasis: z.string().max(150).optional() }).strict(),
  image: z.object({ artifactId: idSchema, alt: z.string().max(500), fit: z.enum(['cover', 'contain']).default('contain') }).strict(),
  audio: z.object({ artifactId: idSchema.optional(), narration: z.string().max(8000).optional(), transcript: z.string().max(8000) }).strict(),
  video: z.object({ artifactId: idSchema, posterArtifactId: idSchema.optional(), caption: z.string().max(1000), loop: z.boolean().default(false) }).strict(),
  scene2d: sceneSchema,
  presenter: z.object({ label: z.string().max(100) }).strict(),
};
export type RendererName = keyof typeof rendererPayloadSchemas;
export type SceneSpec = z.infer<typeof sceneSchema>;
export const nodeSchema = z.object({
  id: idSchema,
  renderer: z.string().min(1).max(80),
  slot: z.enum(['background', 'hero', 'title', 'body', 'aside', 'overlay']).default('hero'),
  payload: z.record(z.unknown()),
  startMs: z.number().int().min(0).max(60000).default(0),
}).strict();
export const experienceSpecSchema = z.object({
  version: z.literal(1), title: z.string().min(1).max(150),
  composition: z.enum(['orbital', 'kinetic', 'lyrical', 'editorial', 'explanation']),
  palette: z.enum(['cosmos', 'paper', 'dusk']),
  summary: z.string().min(1).max(10000),
  nodes: z.array(nodeSchema).min(1).max(30),
}).strict().superRefine((spec, ctx) => {
  if (spec.composition === 'explanation' && (spec.nodes.length < 2 || spec.nodes.length > 4 || spec.nodes.some(node => node.renderer !== 'explanation-point'))) {
    ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'An explanation requires two to four paired visual points.' });
  }
  const seen = new Set<string>();
  spec.nodes.forEach((node, i) => {
    if (seen.has(node.id)) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'id'], message: 'Duplicate node ID' });
    seen.add(node.id);
    const schema = Object.hasOwn(rendererPayloadSchemas, node.renderer) ? rendererPayloadSchemas[node.renderer as RendererName] : undefined;
    if (!schema) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'renderer'], message: 'Unsupported renderer' });
    else if (!schema.safeParse(node.payload).success) ctx.addIssue({ code: 'custom', path: ['nodes', i, 'payload'], message: 'Invalid renderer payload' });
  });
});
export type ExperienceSpec = z.infer<typeof experienceSpecSchema>;
export type ExperienceNode = z.infer<typeof nodeSchema>;
export interface Owner { id: string; name: string; createdAt: string }
export interface VisitorSession { id: string; createdAt: string }
export interface Artifact { id: string; ownerId: string; contentType: string; storageKey: string; byteLength: number; metadata: Record<string, unknown>; provenance: Record<string, unknown>; createdAt: string }
export interface Experience { id: string; visitorSessionId: string; intent: string; status: 'pending' | 'complete' | 'failed'; provider: string; spec: ExperienceSpec | null; error: string | null; createdAt: string; updatedAt: string }
export interface CapabilityDescriptor { name: string; description: string; available: boolean; requiresProvider: boolean }
export interface GenerationContext { intent: string; capabilities: CapabilityDescriptor[]; artifacts: Artifact[] }
export interface GeneratedImage { bytes: Uint8Array; contentType: string; provenance: Record<string, unknown> }
export interface GeneratedExplanation { kind: 'visual-explanation'; title: string; summary: string; points: { title: string; text: string; alt: string; image: GeneratedImage }[]; development: boolean }
export type GenerationResult = ExperienceSpec | GeneratedExplanation;
export interface GenerativeProvider { readonly name: string; generate(context: GenerationContext): Promise<GenerationResult> }
export const createIntentSchema = z.object({ intent: z.string().trim().min(1).max(2000), reference: z.boolean().optional() }).strict();
