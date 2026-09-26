import type { GeneratedExplanation, GenerativeProvider, GenerationContext } from '../../src/shared/spec.js';
import { validateGeneratedExplanation } from '../domain/generated-explanation.js';

type Draft = { title: string; summary: string; points: { title: string; text: string; alt: string }[] };
/** Development content is isolated here. No topic-specific code exists in the presentation layer. */
export class DevelopmentGenerativeProvider implements GenerativeProvider {
  readonly name = 'development';
  async generate({ intent }: GenerationContext): Promise<GeneratedExplanation> {
    const draft = developmentDraft(intent);
    return validateGeneratedExplanation({ kind: 'visual-explanation', ...draft, development: true, points: draft.points.map((point, index) => ({ ...point, image: {
      bytes: Buffer.from(placeholder(index)), contentType: 'image/svg+xml',
      provenance: { provider: 'development', generated: false, source: 'development-placeholder', pointIndex: index },
    } })) });
  }
}
function placeholder(index: number) {
  // Deliberately not a topic image. This tests binary persistence without pretending to be AI output.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><radialGradient id="g"><stop stop-color="#253f61"/><stop offset="1" stop-color="#101927"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><rect x="140" y="100" width="1000" height="520" rx="24" fill="none" stroke="#8da9d0" stroke-opacity=".2" stroke-dasharray="8 10"/><text x="640" y="320" text-anchor="middle" fill="#a6bddd" font-family="sans-serif" font-size="70" font-weight="300">0${index + 1}</text><text x="640" y="392" text-anchor="middle" fill="#d8e4f4" font-family="sans-serif" font-size="24">Your explanatory image belongs here</text><text x="640" y="445" text-anchor="middle" fill="#8a9fb9" font-family="sans-serif" font-size="17">DEVELOPMENT PLACEHOLDER · NOT AI GENERATED</text></svg>`;
}
function developmentDraft(intent: string): Draft {
  if (/\bseason|solstice|equinox/i.test(intent)) return {
    title: 'One small tilt. Four seasons.', summary: 'Earth’s tilted axis changes the angle and duration of sunlight each hemisphere receives during the year.', points: [
      { title: 'Earth keeps its 23.4° tilt', text: 'Earth’s spin axis is tilted about 23.4° from the perpendicular to its orbital plane. As Earth travels around the Sun, that axis stays pointed in nearly the same direction.', alt: 'Intended visual: Earth at opposite positions around the Sun, with parallel rotation axes tilted 23.4°.' },
      { title: 'More direct light, longer days', text: 'When a hemisphere tilts toward the Sun, sunlight strikes it more directly and days last longer. More energy reaches the ground each day, producing summer; the opposite hemisphere has winter.', alt: 'Intended visual: compare sunlight concentrated on the summer hemisphere with sunlight spread over the winter hemisphere and show day lengths.' },
      { title: 'Six months later, the roles reverse', text: 'On the opposite side of its orbit, the other hemisphere leans toward the Sun. Earth’s changing distance from the Sun is not what causes the seasons.', alt: 'Intended visual: June and December positions with the same fixed axial direction and reversed northern and southern seasons.' },
    ],
  };
  if (/(?:cpu|processor).*(?:instruction|execute)|instruction.*(?:cpu|processor)/i.test(intent)) return {
    title: 'From instruction to action.', summary: 'A CPU follows a repeating fetch–decode–execute cycle, moving instructions and data between memory, registers and its execution units.', points: [
      { title: 'Fetch the next instruction', text: 'The program counter holds the address of the next instruction. The CPU requests the instruction from the memory system and brings it into the processor, usually through its instruction cache.', alt: 'Intended visual: arrows from program counter to memory address, then instruction cache to an instruction register, labeled Fetch.' },
      { title: 'Decode what needs to happen', text: 'The control unit interprets the instruction’s operation and operands. It selects the needed registers or memory values and directs the relevant execution unit.', alt: 'Intended visual: instruction fields feed the decoder; control signals select operand registers and the ALU.' },
      { title: 'Execute and write the result', text: 'For an arithmetic instruction, the ALU computes using the selected operands and writes the result to a register. The program counter advances or changes for a branch. Real CPUs overlap these stages, but this is the basic cycle.', alt: 'Intended visual: two operand registers feed the ALU, which writes a result register; a branch path updates the program counter.' },
    ],
  };
  if (/\bdna\b.*replicat|replicat.*\bdna\b/i.test(intent)) return {
    title: 'How DNA makes a copy.', summary: 'Each original DNA strand becomes a template for a new complementary strand, producing two DNA molecules.', points: [
      { title: 'Unzip the double helix', text: 'Helicase separates the two DNA strands at a replication fork. Each exposed strand provides a template, while other proteins keep the strands apart and relieve twisting strain.', alt: 'Intended visual: helicase at a replication fork separating paired DNA strands, with each template strand labeled.' },
      { title: 'Build complementary strands', text: 'After primase lays down a primer, DNA polymerase adds matching bases: A pairs with T, and C with G. New DNA grows only in the 5′ to 3′ direction, so one strand forms continuously and the other in short Okazaki fragments.', alt: 'Intended visual: a replication fork with continuous leading-strand synthesis and lagging-strand Okazaki fragments; label 5′ and 3′ directions.' },
      { title: 'Join and check the copies', text: 'RNA primers are removed and replaced with DNA. DNA ligase seals gaps between fragments. Polymerase proofreading and repair reduce errors. Each completed DNA molecule contains one original strand and one new strand.', alt: 'Intended visual: ligase sealing adjacent DNA fragments, followed by two daughter molecules colored by original and newly synthesized strands.' },
    ],
  };
  return { title: 'A question worth exploring.', summary: 'This is the development preview. A Gemini key enables original explanations and images for your question.', points: [
    { title: 'Your question, clearly explained', text: 'The live provider selects a few essential points and writes a concise explanation for each. This preview does not invent an answer to a question outside its development examples.', alt: 'Development placeholder for the first point’s explanatory image.' },
    { title: 'A visual for every point', text: 'Each point is paired with a native generated image from the same request. Try seasons, CPU instruction execution or DNA replication to inspect the development flow.', alt: 'Development placeholder for a second point’s explanatory image.' },
  ] };
}
