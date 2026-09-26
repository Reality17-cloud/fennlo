import { z } from 'zod';
import type { GeneratedExplanation } from '../../src/shared/spec.js';

export const explanationOverviewSchema = z.object({ title: z.string().trim().min(1).max(150), summary: z.string().trim().min(1).max(1000) }).strict();
export const explanationPointSchema = z.object({ title: z.string().trim().min(1).max(140), text: z.string().trim().min(1).max(1200), alt: z.string().trim().min(1).max(700) }).strict();
const generatedExplanationSchema = explanationOverviewSchema.extend({
  kind: z.literal('visual-explanation'), development: z.boolean(),
  points: z.array(explanationPointSchema.extend({ image: z.object({
    bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= 12 * 1024 * 1024),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']), provenance: z.record(z.unknown()),
  }).strict() })).min(2).max(4),
}).strict();

/** Validate binary output before any persistence, independently of the selected provider. */
export function validateGeneratedExplanation(value: unknown): GeneratedExplanation {
  const result = generatedExplanationSchema.parse(value);
  for (const point of result.points) {
    const { bytes, contentType } = point.image;
    const b = Buffer.from(bytes);
    const valid = contentType === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : contentType === 'image/webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
      : result.development && b.toString('utf8').startsWith('<svg xmlns="http://www.w3.org/2000/svg"');
    if (!valid) throw new Error('The generated image format is invalid.');
    if (!result.development && point.image.provenance.generated !== true) throw new Error('A native generated image is required.');
  }
  return result;
}
