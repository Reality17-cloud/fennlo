import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GenerativeViewport } from './runtime/Runtime';
import { experienceSpecSchema, type Experience } from './shared/spec';

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!contentType.includes('application/json')) {
    const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(
      response.status === 404
        ? 'Fennlo API is not deployed on this host yet.'
        : `Fennlo API returned an unexpected response${snippet ? `: ${snippet}` : '.'}`,
    );
  }
  try { return JSON.parse(body) as T; }
  catch { throw new Error('Fennlo API returned invalid JSON.'); }
}

const suggestions = [
  { question: 'Why do seasons happen?', icon: 'sun' },
  { question: 'How does a CPU execute an instruction?', icon: 'chip' },
  { question: 'How does DNA replication work?', icon: 'dna' },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'arrow' ? <path d="M12 19V5m-6 6 6-6 6 6" />
      : name === 'sound' ? <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>
      : name === 'mute' ? <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/></>
      : name === 'pause' ? <path d="M8 5v14M16 5v14"/>
      : name === 'play' ? <path d="m8 5 11 7-11 7V5Z"/>
      : name === 'close' ? <path d="m6 6 12 12M6 18 18 6"/>
      : name === 'read' ? <><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></>
      : name === 'sun' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>
      : name === 'chip' ? <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/></>
      : name === 'dna' ? <><path d="M8 3c0 8 8 10 8 18M16 3c0 8-8 10-8 18M8.5 5h7M9 19h6M10 9h4M10 15h4"/></>
      : <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>}
  </svg>;
}

export function App() {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [provider, setProvider] = useState('');
  const [narrationState, setNarrationState] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const transcriptDialog = useRef<HTMLDialogElement>(null);
  const spec = experience?.spec ?? null;
  const legacy = !!spec && spec.composition !== 'explanation';
  const development = (experience?.provider ?? provider) === 'development';

  useEffect(() => {
    const startup = new AbortController();
    fetch('/api/status', { signal: startup.signal }).then(async r => { if (!r.ok) throw new Error('status unavailable'); return readJsonResponse<{ provider: string }>(r); }).then(data => setProvider(data.provider)).catch(() => {});
    const id = new URLSearchParams(location.search).get('experience');
    if (id && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      setBusy(true); setRestoring(true);
      fetch(`/api/experiences/${encodeURIComponent(id)}`, { signal: startup.signal }).then(async r => {
        if (!r.ok) throw new Error('This experience is not available in this browser. Start with a new question.');
        const data = await readJsonResponse<{ experience: Experience }>(r);
        if (data.experience.status !== 'complete') throw new Error('This experience did not finish. Try your question again.');
        const parsed = experienceSpecSchema.safeParse(data.experience.spec);
        if (!parsed.success) throw new Error('This saved explanation could not be read. Please ask your question again.');
        data.experience.spec = parsed.data;
        if (!startup.signal.aborted) setExperience(data.experience);
      }).catch((e: unknown) => {
        if (!startup.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to restore this experience.');
      }).finally(() => { if (!startup.signal.aborted) { setBusy(false); setRestoring(false); } });
    }
    return () => { startup.abort(); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    document.title = experience ? `${experience.spec?.title ?? 'Experience'} · Fennlo` : 'Fennlo — A space for understanding';
  }, [experience]);
  useEffect(() => {
    if (transcript) transcriptDialog.current?.showModal();
    else transcriptDialog.current?.close();
  }, [transcript]);

  async function generate(value: string) {
    if (!value.trim() || busy) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const sequence = ++requestSequence.current;
    setIntent(value); setBusy(true); setError(''); setTranscript(false); setNarrationState('');
    try {
      const response = await fetch('/api/experiences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: value.trim() }), signal: controller.current.signal });
      const data = await readJsonResponse<{ experience?: Experience; error?: string }>(response);
      if (!response.ok || !data.experience) throw new Error(data.error || 'The experience could not be created. Please try again.');
      const next = data.experience;
      const parsed = experienceSpecSchema.safeParse(next.spec);
      if (!parsed.success) throw new Error('The explanation could not be displayed. Please try your question again.');
      next.spec = parsed.data;
      if (sequence !== requestSequence.current) return;
      setExperience(next); setIntent(''); setPaused(false);
      history.replaceState(null, '', `/?experience=${encodeURIComponent(next.id)}`);
      input.current?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) {
      if (sequence === requestSequence.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : 'Unable to connect. Please try again.');
    } finally { if (sequence === requestSequence.current) setBusy(false); }
  }
  function reset() {
    if (busy) return;
    ++requestSequence.current; controller.current?.abort(); setExperience(null); setError(''); setIntent(''); setTranscript(false); setMuted(true);
    history.replaceState(null, '', '/'); input.current?.focus();
  }
  function submit(event: FormEvent) { event.preventDefault(); void generate(intent); }

  return <div className={`app-shell palette-${legacy ? spec.palette : 'cosmos'} ${experience ? 'is-experiencing' : 'is-welcome'} ${legacy ? 'is-legacy' : 'is-visual'} ${busy ? 'is-generating' : ''}`}>
    <div className="environment-backdrop" aria-hidden="true">
      <div className="backdrop-window" />
      <div className="backdrop-shelf" />
      <div className="backdrop-stars" />
      <div className="backdrop-horizon" />
      <div className="backdrop-orb backdrop-orb-one" />
      <div className="backdrop-orb backdrop-orb-two" />
    </div>
    <a className="skip-link" href="#intent">Skip to question</a>
    <header className="shell-header">
      <button className="wordmark" onClick={reset} disabled={busy} aria-label="Fennlo home">FENNLO</button>
      <div className="environment-controls">
        {legacy && <>
          <button className="icon-button" aria-label="Read explanation" title="Read explanation" onClick={() => setTranscript(true)}><Icon name="read"/></button>
          <button className="icon-button" aria-label={paused ? 'Resume motion' : 'Pause motion'} title={paused ? 'Resume motion' : 'Pause motion'} onClick={() => setPaused(p => !p)}><Icon name={paused ? 'play' : 'pause'}/></button>
          <button className="sound-button" aria-label={muted ? 'Enable narration' : 'Mute narration'} title={muted ? 'Enable narration' : 'Mute narration'} onClick={() => setMuted(m => !m)}><Icon name={muted ? 'mute' : 'sound'}/><span>{muted ? 'Sound off' : 'Sound on'}</span></button>
        </>}
        {!legacy && <span className={`readiness-badge ${development ? 'is-development' : ''}`}><span aria-hidden="true"/>{busy ? restoring ? 'Opening experience' : 'Creating your answer' : development ? 'Development preview' : experience ? 'Visual explanation' : 'Room for curiosity'}</span>}
      </div>
    </header>
    <main className="experience-stage" aria-label="Generative experience" aria-busy={busy}>
      {spec && <GenerativeViewport key={experience?.id} spec={spec} muted={muted} paused={paused} onNarrationState={setNarrationState}/>}
      {!experience && <section className="welcome-copy" aria-labelledby="welcome-title">
        <div className="welcome-symbol" aria-hidden="true"><Icon name="spark" size={30}/></div>
        <div className="presence-label">A SPACE FOR UNDERSTANDING</div>
        <h1 id="welcome-title">A question opens<br/><span>a whole new world.</span></h1>
        <p>See the idea. Understand the why.<br/>Turn your curiosity into a clear visual explanation.</p>
        <div className="question-suggestions" aria-label="Try a question">
          {suggestions.map(suggestion => <button key={suggestion.icon} disabled={busy} onClick={() => void generate(suggestion.question)}><Icon name={suggestion.icon} size={19}/><span>{suggestion.question}</span><span className="prompt-arrow" aria-hidden="true">↗</span></button>)}
        </div>
      </section>}
    </main>
    <section className="intent-dock" aria-label="Ask a question">
      {busy && <div className="forming-status" role="status"><span className="forming-orb" aria-hidden="true"/>{restoring ? 'Opening your saved explanation…' : 'Connecting the ideas. Creating your visuals…'}</div>}
      {error && <div className="error-message" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={18}/></button></div>}
      <form className="intent-form" onSubmit={submit}>
        <span className="input-spark" aria-hidden="true"><Icon name="spark" size={22}/></span>
        <label className="sr-only" htmlFor="intent">What would you like to understand?</label>
        <input ref={input} id="intent" name="intent" value={intent} onChange={e => setIntent(e.target.value)} maxLength={2000} placeholder={experience ? 'What else would you like to understand?' : 'What would you like to understand?'} autoComplete="off" disabled={busy}/>
        <button className="submit-intent" type="submit" aria-label="Create experience" disabled={busy || !intent.trim()}><Icon name="arrow" size={21}/></button>
      </form>
      <p className="dock-caption">{development ? 'Development preview · Placeholder visuals, not AI-generated images.' : 'A little curiosity. A clearer picture.'}</p>
    </section>
    <div className="sr-only" role="status" aria-live="polite">{experience ? `Experience ready: ${spec?.title}.` : ''}{narrationState}</div>
    {legacy && <dialog ref={transcriptDialog} className="transcript-dialog" onCancel={() => setTranscript(false)} onClick={e => { if (e.target === e.currentTarget) setTranscript(false); }}>
      <button className="transcript-close icon-button" onClick={() => setTranscript(false)} aria-label="Close explanation"><Icon name="close"/></button>
      <div className="presence-label">YOUR EXPLANATION</div><h2>{spec.title}</h2><p>{spec.summary}</p>
    </dialog>}
  </div>;
}

