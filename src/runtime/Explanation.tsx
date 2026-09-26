import { useEffect, useState } from 'react';
import { z } from 'zod';
import { nodeSchema, rendererPayloadSchemas, type ExperienceSpec } from '../shared/spec';
import './explanation.css';

type Point = z.infer<typeof rendererPayloadSchemas['explanation-point']>;

function PointImage({ point }: { point: Point }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [point.artifactId]);
  return failed
    ? <div className="explanation-image-fallback" role="status">This visual could not be loaded. You can still read the explanation.</div>
    : <img className="explanation-image" src={`/api/artifacts/${encodeURIComponent(point.artifactId)}`} alt={point.alt} onError={() => setFailed(true)} decoding="async"/>;
}

/** A flat, validated point remains renderable through the existing renderer registry. */
export function ExplanationPoint({ point: inputPoint, headingId }: { point: Point & { id?: string }; headingId: string }) {
  const { id: _id, ...payload } = inputPoint;
  const parsed = rendererPayloadSchemas['explanation-point'].safeParse(payload);
  if (!parsed.success) return <p className="explanation-unavailable" role="status">This part of the explanation is unavailable.</p>;
  const point = parsed.data;
  return <>
    <div className="explanation-visual"><PointImage point={point}/></div>
    <div className="explanation-point-copy">
      <h2 id={headingId}>{point.title}</h2>
      <div className="explanation-point-text">{point.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </div>
  </>;
}

export function ExplanationPointRenderer({ payload }: { payload: Record<string, unknown> }) {
  const parsed = rendererPayloadSchemas['explanation-point'].safeParse(payload);
  if (!parsed.success) return <p className="explanation-unavailable" role="status">This part of the explanation is unavailable.</p>;
  return <ExplanationPoint point={parsed.data} headingId="explanation-point-heading" />;
}

export function Explanation({ spec }: { spec: ExperienceSpec }) {
  const points = spec.nodes.flatMap(node => {
    const shape = nodeSchema.safeParse(node);
    if (!shape.success || node.renderer !== 'explanation-point') return [];
    const parsed = rendererPayloadSchemas['explanation-point'].safeParse(node.payload);
    return parsed.success ? [{ ...parsed.data, id: node.id }] : [];
  });
  const primary = points[0];
  const supporting = points.slice(1);
  const overview = spec.summary.split(/\n\s*\n/)[0];

  return <section className="explanation-view" aria-labelledby="explanation-title">
    <div className="explanation-ambient" aria-hidden="true">
      <div className="ambient-halo" />
      <div className="ambient-avatar"><span className="avatar-head"/><span className="avatar-body"/><span className="avatar-core"/></div>
    </div>
    <div className="explanation-content">
      <header className="explanation-heading">
        <div className="presence-label"><span aria-hidden="true"/>A VISUAL EXPLANATION</div>
        <h1 id="explanation-title">{spec.title}</h1>
        <p>{overview}</p>
      </header>
      <aside className="explanation-guide" aria-label="Explanation guide">
        <span className="guide-signal" aria-hidden="true"><i/><i/><i/><i/><i/></span>
        <div>
          <strong>Here’s a quick visual guide.</strong>
          <p>Start with the main idea, then follow the supporting visuals below.</p>
        </div>
      </aside>
      {primary ? <>
        <article className="explanation-hero" data-renderer="explanation-point" data-node-id={primary.id} aria-labelledby={`primary-point-${primary.id}`}>
          <div className="explanation-hero-content"><ExplanationPoint point={primary} headingId={`primary-point-${primary.id}`} /></div>
        </article>
        {supporting.length > 0 && <section className="explanation-points" aria-label="Supporting explanation points">
          {supporting.map(point => <article key={point.id} className="explanation-support-point" data-renderer="explanation-point" data-node-id={point.id}>
            <ExplanationPoint point={point} headingId={`supporting-point-${point.id}`} />
          </article>)}
        </section>}
      </> : <p className="explanation-unavailable" role="status">The visual points are unavailable. {spec.summary}</p>}
    </div>
  </section>;
}
