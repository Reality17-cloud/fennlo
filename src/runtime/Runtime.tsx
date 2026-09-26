import { Component, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { z } from 'zod';
import { nodeSchema, rendererPayloadSchemas, type ExperienceNode, type ExperienceSpec, type RendererName } from '../shared/spec';
import { SceneRenderer } from './scenes';
import { Explanation, ExplanationPointRenderer } from './Explanation';
import './runtime.css';

export type NarrationState = 'idle' | 'playing' | 'paused' | 'unavailable';
export interface GenerativeViewportProps {
  spec: ExperienceSpec | null;
  muted: boolean;
  paused: boolean;
  onNarrationState?: (state: NarrationState) => void;
}
export interface RendererContext {
  payload: Record<string, unknown>;
  muted: boolean;
  paused: boolean;
  reducedMotion: boolean;
  onNarrationState?: (state: NarrationState) => void;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return reduced;
}

function Backdrop({ payload }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.backdrop>;
  return <div className={`runtime-backdrop backdrop-${p.palette}${p.grain ? ' with-grain' : ''}`} aria-hidden="true">
    <div className="atmosphere-glow" />
    {p.palette === 'cosmos' && <div className="star-field">{Array.from({ length: 60 }, (_, i) => <i key={i} style={{ left: `${(i * 43.719 + 9) % 100}%`, top: `${(i * 29.613 + 2) % 100}%`, opacity: .14 + (i % 5) * .09, width: i % 7 === 0 ? 2 : 1, height: i % 7 === 0 ? 2 : 1 }} />)}</div>}
  </div>;
}

function TextRenderer({ payload }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.text>;
  const className = `runtime-text text-${p.role}`;
  if (p.role === 'title') return <h1 className={className}>{p.text}</h1>;
  if (p.role === 'verse') return <blockquote className={className}>{p.text}</blockquote>;
  return <p className={className}>{p.text}</p>;
}

function MediaFallback({ children }: { children: ReactNode }) {
  return <div className="media-fallback" role="status"><span aria-hidden="true">◌</span><p>{children}</p></div>;
}

function ImageRenderer({ payload }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.image>;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [p.artifactId]);
  return failed ? <MediaFallback>{p.alt || 'This image is unavailable.'}</MediaFallback> : <img className={`runtime-image fit-${p.fit}`} src={`/api/artifacts/${encodeURIComponent(p.artifactId)}`} alt={p.alt} onError={() => setFailed(true)} />;
}

function AudioRenderer({ payload, muted, paused, onNarrationState }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.audio>;
  const audio = useRef<HTMLAudioElement>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const pausedRef = useRef(paused);
  const callback = useRef(onNarrationState);
  callback.current = onNarrationState;
  pausedRef.current = paused;
  useEffect(() => {
    if (p.artifactId || !p.narration || muted) {
      callback.current?.('idle');
      return;
    }
    if (!('speechSynthesis' in window)) {
      callback.current?.('unavailable');
      return;
    }
    const speech = new SpeechSynthesisUtterance(p.narration);
    speech.rate = .89;
    speech.pitch = .95;
    speech.lang = 'en-US';
    speech.onstart = () => callback.current?.(pausedRef.current ? 'paused' : 'playing');
    speech.onend = () => callback.current?.('idle');
    speech.onerror = (event) => { if (event.error !== 'interrupted' && event.error !== 'canceled') callback.current?.('unavailable'); };
    utterance.current = speech;
    window.speechSynthesis.speak(speech);
    if (pausedRef.current) window.speechSynthesis.pause();
    return () => {
      speech.onstart = null;
      speech.onend = null;
      speech.onerror = null;
      window.speechSynthesis.cancel();
      utterance.current = null;
    };
  }, [p.artifactId, p.narration, muted]);
  useEffect(() => {
    if (utterance.current && 'speechSynthesis' in window) {
      if (paused) window.speechSynthesis.pause();
      else window.speechSynthesis.resume();
      callback.current?.(paused ? 'paused' : muted ? 'idle' : 'playing');
    }
    const media = audio.current;
    if (!media) return;
    media.muted = muted;
    if (paused || muted) {
      media.pause();
      callback.current?.(paused && !muted ? 'paused' : 'idle');
    } else {
      void media.play().then(() => callback.current?.('playing')).catch(() => callback.current?.('unavailable'));
    }
  }, [muted, paused, p.artifactId]);
  return <>
    {p.artifactId && <audio ref={audio} src={`/api/artifacts/${encodeURIComponent(p.artifactId)}`} preload="metadata" onError={() => callback.current?.('unavailable')} onEnded={() => callback.current?.('idle')} />}
    <span className="runtime-sr-only">{p.transcript}</span>
  </>;
}

function VideoRenderer({ payload, muted, paused, reducedMotion }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.video>;
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [p.artifactId]);
  useEffect(() => {
    const media = video.current;
    if (!media) return;
    media.muted = muted;
    if (paused || reducedMotion) media.pause();
    else void media.play().catch(() => { /* The poster and caption remain when autoplay is blocked. */ });
  }, [paused, muted, reducedMotion, p.artifactId]);
  return <figure className="runtime-video">
    {failed ? <MediaFallback>{p.caption || 'This video is unavailable.'}</MediaFallback> : <video ref={video} src={`/api/artifacts/${encodeURIComponent(p.artifactId)}`} poster={p.posterArtifactId ? `/api/artifacts/${encodeURIComponent(p.posterArtifactId)}` : undefined} muted={muted} playsInline loop={p.loop} preload="metadata" onError={() => setFailed(true)} />}
    {p.caption && <figcaption>{p.caption}</figcaption>}
  </figure>;
}

function Presenter({ payload }: RendererContext) {
  const p = payload as z.infer<typeof rendererPayloadSchemas.presenter>;
  return <div className="runtime-presenter"><span className="presenter-orb" aria-hidden="true"><i /><i /><i /></span><span>{p.label}</span></div>;
}

/** Add a payload schema and component here to extend the public runtime. No artifact migration is needed. */
export const rendererRegistry: Record<RendererName, { schema: z.ZodTypeAny; render: ComponentType<RendererContext> }> = {
  'explanation-point': { schema: rendererPayloadSchemas['explanation-point'], render: ExplanationPointRenderer },
  backdrop: { schema: rendererPayloadSchemas.backdrop, render: Backdrop },
  text: { schema: rendererPayloadSchemas.text, render: TextRenderer },
  image: { schema: rendererPayloadSchemas.image, render: ImageRenderer },
  audio: { schema: rendererPayloadSchemas.audio, render: AudioRenderer },
  video: { schema: rendererPayloadSchemas.video, render: VideoRenderer },
  scene2d: { schema: rendererPayloadSchemas.scene2d, render: SceneRenderer },
  presenter: { schema: rendererPayloadSchemas.presenter, render: Presenter },
};

class RendererBoundary extends Component<{ children: ReactNode; node: ExperienceNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Individual renderer failures never interrupt the composition. */ }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; node: ExperienceNode }>) {
    if (previous.node !== this.props.node && this.state.failed) this.setState({ failed: false });
  }
  render() { return this.state.failed ? <p className="renderer-fallback" role="status">One part of this experience could not be displayed. The explanation is still available in the transcript.</p> : this.props.children; }
}

export function ExperienceNodeRenderer({ node, ...context }: Omit<RendererContext, 'payload'> & { node: ExperienceNode }) {
  const shape = nodeSchema.safeParse(node);
  if (!shape.success) return <p className="renderer-fallback" data-renderer="unavailable" role="status">One part of this experience is unavailable.</p>;
  const registration = Object.hasOwn(rendererRegistry, node.renderer) ? rendererRegistry[node.renderer as RendererName] : undefined;
  const parsed = registration?.schema.safeParse(node.payload);
  if (!registration || !parsed?.success) return <p className="renderer-fallback" data-renderer="unavailable" role="status">One part of this experience is unavailable.</p>;
  const Renderer = registration.render;
  const role = node.renderer === 'text' ? String(parsed.data.role) : '';
  return <div className={`experience-node node-${node.renderer} slot-${node.slot}${role ? ` role-${role}` : ''}`} data-renderer={node.renderer} data-node-id={node.id} style={{ animationDelay: `${context.reducedMotion ? 0 : node.startMs}ms` }}>
    <RendererBoundary node={node}><Renderer {...context} payload={parsed.data as Record<string, unknown>} /></RendererBoundary>
  </div>;
}

export function GenerativeViewport({ spec, muted, paused, onNarrationState }: GenerativeViewportProps) {
  const reducedMotion = useReducedMotion();
  return <div className={`generative-viewport composition-${spec?.composition ?? 'editorial'} palette-${spec?.palette ?? 'cosmos'}${paused ? ' runtime-paused' : ''}${reducedMotion ? ' runtime-reduced' : ''}`} data-composition={spec?.composition ?? 'editorial'} aria-label={spec?.title ?? 'Fennlo environment'}>
    {spec?.composition === 'explanation' ? <Explanation spec={spec}/> : spec?.nodes?.map((node, index) => <ExperienceNodeRenderer key={`${spec.title}-${node.id ?? index}`} node={node} muted={muted} paused={paused} reducedMotion={reducedMotion} onNarrationState={onNarrationState} />)}
  </div>;
}
