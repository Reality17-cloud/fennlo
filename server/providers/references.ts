import { experienceSpecSchema, type ExperienceNode, type ExperienceSpec } from '../../src/shared/spec.js';

const node = (id: string, renderer: string, slot: ExperienceNode['slot'], payload: Record<string, unknown>, startMs = 0): ExperienceNode => ({ id, renderer, slot, payload, startMs });

const seasonsSummary = 'Seasons happen because Earth’s rotation axis is tilted about 23.4° from the perpendicular to its orbital plane. As Earth goes around the Sun, its axis stays pointed in nearly the same direction in space. A hemisphere tilted toward the Sun receives more direct sunlight and has longer days: summer. The opposite hemisphere receives less direct sunlight and has shorter days: winter. About six months later the hemispheres exchange roles. Near the equinoxes, day and night are approximately equal in length. The changing Earth–Sun distance is not the cause of the seasons. The scene is a simplified model; sizes, distances and the speed of the orbit are not to scale.';
const accelerationSummary = 'Acceleration is the rate at which velocity changes. In this one-dimensional example, an object starts at rest and accelerates steadily at 2 metres per second squared. Its speed increases by 2 metres per second each second: 2 m/s after one second, 4 m/s after two, and 6 m/s after three. Because the speed keeps increasing, the object covers more distance during each equal interval of time. From rest, velocity is v = at and distance is s = ½at². Acceleration can also mean slowing down or changing direction; this scene shows only speeding up in a straight line. The motion repeats so the pattern is easy to compare.';
const poem = ['I set a small stone in the stream.', 'The water learns another way.', 'By dusk the stone has lost its name.', 'The river carries on the day.'];
const poemSummary = `What the water keeps — an original poem for Fennlo.\n\n${poem.join('\n')}\n\nOne reading: the stone stands for something we introduce into the world, while the stream stands for time. The water changes course around the stone without stopping. “Lost its name” suggests that the identity or importance we give an event can soften as time passes. The last line returns to movement: life continues, carrying traces of what it meets. This is an interpretation, not the poem’s only possible meaning.`;

/** Authored content uses precisely the same validated protocol as provider output. */
export function seasonsReference(): ExperienceSpec {
  return experienceSpecSchema.parse({ version: 1, title: 'Why seasons happen', composition: 'orbital', palette: 'cosmos', summary: seasonsSummary, nodes: [
    node('atmosphere', 'backdrop', 'background', { palette: 'cosmos', grain: true }),
    node('chapter', 'text', 'title', { role: 'eyebrow', text: '01 / THE REASON FOR SEASONS' }),
    node('headline', 'text', 'title', { role: 'title', text: 'A little tilt.\nA world of difference.' }),
    node('orbit', 'scene2d', 'hero', { kind: 'seasons', tilt: 23.4, labels: ['Earth’s axis stays parallel', '23.4° axial tilt', 'Longer days · more direct light', 'Shorter days · less direct light'] }),
    node('explanation', 'text', 'body', { role: 'body', text: 'Earth leans 23.4°. As it circles the Sun, each hemisphere takes its turn in the light.' }, 180),
    node('insight', 'text', 'aside', { role: 'caption', text: 'A hemisphere tilted toward the Sun gets longer days and more direct light. Six months later, the roles reverse.' }, 320),
    node('voice', 'audio', 'overlay', { narration: seasonsSummary, transcript: seasonsSummary }),
  ] });
}

export function accelerationReference(): ExperienceSpec {
  return experienceSpecSchema.parse({ version: 1, title: 'See acceleration', composition: 'kinetic', palette: 'paper', summary: accelerationSummary, nodes: [
    node('atmosphere', 'backdrop', 'background', { palette: 'paper', grain: true }),
    node('chapter', 'text', 'title', { role: 'eyebrow', text: '02 / A FEELING FOR ACCELERATION' }),
    node('headline', 'text', 'title', { role: 'title', text: 'Speed is a moment.\nAcceleration is a change.' }),
    node('motion', 'scene2d', 'hero', { kind: 'acceleration', acceleration: 2, duration: 8 }),
    node('explanation', 'text', 'body', { role: 'body', text: 'Equal moments. Longer journeys. With steady acceleration, every second adds the same amount of speed.' }, 180),
    node('insight', 'text', 'aside', { role: 'caption', text: 'FROM REST · a = 2 m/s²\nVelocity: v = at · Distance: s = ½at²' }),
    node('voice', 'audio', 'overlay', { narration: accelerationSummary, transcript: accelerationSummary }),
  ] });
}

export function poemReference(): ExperienceSpec {
  return experienceSpecSchema.parse({ version: 1, title: 'What the water keeps', composition: 'lyrical', palette: 'dusk', summary: poemSummary, nodes: [
    node('atmosphere', 'backdrop', 'background', { palette: 'dusk', grain: true }),
    node('chapter', 'text', 'title', { role: 'eyebrow', text: '03 / A POEM, FELT FIRST' }),
    node('headline', 'text', 'title', { role: 'title', text: 'What the water keeps.' }),
    node('water', 'scene2d', 'hero', { kind: 'ripples', lines: poem }),
    node('verse', 'text', 'hero', { role: 'verse', text: poem.join('\n') }, 180),
    node('explanation', 'text', 'body', { role: 'body', text: 'Perhaps the stone is a memory, and the river is time. What we meet changes our course. We keep moving.' }, 500),
    node('attribution', 'text', 'aside', { role: 'caption', text: 'AN ORIGINAL POEM FOR FENNLO · ONE POSSIBLE READING' }),
    node('voice', 'audio', 'overlay', { narration: poemSummary, transcript: poemSummary }),
  ] });
}

export function openIntentReference(intent: string): ExperienceSpec {
  const excerpt = intent.replace(/\s+/g, ' ').trim().slice(0, 180);
  const summary = `You asked: “${excerpt}”. This local Fennlo currently presents three authored experiences: why seasons happen, acceleration, and an original short poem. A live AI provider is not connected, so it cannot yet generate a reliable answer to this request. Choose one of the three invitations below to explore the environment.`;
  return experienceSpecSchema.parse({ version: 1, title: 'A place for your curiosity', composition: 'editorial', palette: 'dusk', summary, nodes: [
    node('atmosphere', 'backdrop', 'background', { palette: 'dusk', grain: true }),
    node('chapter', 'text', 'title', { role: 'eyebrow', text: 'A PLACE FOR YOUR CURIOSITY' }),
    node('headline', 'text', 'title', { role: 'title', text: 'Every question\nis a beginning.' }),
    node('intent', 'text', 'hero', { role: 'verse', text: `“${excerpt}”` }),
    node('explanation', 'text', 'body', { role: 'body', text: 'This local edition holds three authored experiences. Live generation is not connected yet. Explore seasons, acceleration, or a short poem below.' }),
  ] });
}

export function referenceForIntent(intent: string): ExperienceSpec {
  const normalized = intent.toLocaleLowerCase('en-US').trim();
  if (/\b(seasons?|solstice|equinox|axial tilt)\b/.test(normalized)) return seasonsReference();
  if (/\b(acceleration|accelerat(?:e|ing)|velocity|speeding up)\b/.test(normalized)) return accelerationReference();
  if (/\b(poem|poetry|verse)\b/.test(normalized)) return poemReference();
  return openIntentReference(intent);
}
