import { useEffect, useId, useRef, useState } from 'react';
import type { SceneSpec } from '../shared/spec';
import type { RendererContext } from './Runtime';

function useSmallViewport() {
  const [small, setSmall] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setSmall(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return small;
}

function SeasonsScene({ scene, paused, reducedMotion }: { scene: Extract<SceneSpec, { kind: 'seasons' }>; paused: boolean; reducedMotion: boolean }) {
  const id = useId().replace(/:/g, '');
  const small = useSmallViewport();
  const [season, setSeason] = useState<'june' | 'december'>('june');
  const summer = season === 'june';
  const axisTilt = summer ? -scene.tilt : scene.tilt;
  return <div className={`scene seasons-scene${summer ? '' : ' winter-scene'}`}>
    <svg className="scene-art seasons-art" viewBox={small ? '460 240 820 530' : '0 0 1440 950'} role="img" aria-label={`Sun and Earth with an axial tilt of ${scene.tilt} degrees. In ${summer ? 'June, the northern hemisphere tilts toward sunlight and has summer' : 'December, the northern hemisphere tilts away from sunlight and has winter'}. Seasons are caused by the tilt, not the distance from the Sun.`}>
      <defs>
        <radialGradient id={`${id}-sun-halo`}><stop stopColor="#efb45d" stopOpacity=".21" /><stop offset=".36" stopColor="#db9b45" stopOpacity=".1" /><stop offset="1" stopColor="#bc7940" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}-sun`} cx="40%" cy="37%"><stop stopColor="#fffde3" /><stop offset=".64" stopColor="#ffdda0" /><stop offset=".9" stopColor="#f5b057" /><stop offset="1" stopColor="#e6913e" /></radialGradient>
        <radialGradient id={`${id}-ocean`} cx="18%" cy="39%" r="92%"><stop stopColor="#6b949b" /><stop offset=".4" stopColor="#345c69" /><stop offset=".73" stopColor="#173747" /><stop offset="1" stopColor="#071825" /></radialGradient>
        <linearGradient id={`${id}-land`} x1="0" y1="0" x2="1" y2=".6"><stop stopColor="#c8bb93" /><stop offset=".44" stopColor="#839378" /><stop offset="1" stopColor="#344d46" /></linearGradient>
        <linearGradient id={`${id}-night`}><stop offset=".1" stopColor="#030b16" stopOpacity="0" /><stop offset=".49" stopColor="#030b16" stopOpacity=".05" /><stop offset=".68" stopColor="#030b16" stopOpacity=".55" /><stop offset="1" stopColor="#020811" stopOpacity=".92" /></linearGradient>
        <linearGradient id={`${id}-rays`}><stop stopColor="#f6d393" stopOpacity=".32" /><stop offset="1" stopColor="#f6d393" stopOpacity=".04" /></linearGradient>
        <radialGradient id={`${id}-earth-halo`}><stop offset=".66" stopColor="#648fa2" stopOpacity="0" /><stop offset=".76" stopColor="#7499a4" stopOpacity=".13" /><stop offset=".82" stopColor="#406b80" stopOpacity=".05" /><stop offset="1" stopColor="#406b80" stopOpacity="0" /></radialGradient>
        <clipPath id={`${id}-globe-clip`}><circle r="148" /></clipPath>
        <filter id={`${id}-sun-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="15" /></filter>
        <filter id={`${id}-texture`} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".056" numOctaves="4" seed="8" /><feColorMatrix type="saturate" values="0" /><feBlend in="SourceGraphic" mode="soft-light" /></filter>
        <marker id={`${id}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1 7 4 1 7" fill="none" stroke="#b4a28a" strokeWidth="1" /></marker>
      </defs>
      <ellipse className="orbit-path orbit-far" cx="797" cy="500" rx="420" ry="132" transform="rotate(-13 797 500)" fill="none" stroke="#8a877c" strokeWidth="1" strokeOpacity=".18" />
      <path d="M399 554 C453 649 846 641 1112 516" fill="none" stroke="#c5b596" strokeOpacity=".29" strokeWidth="1" strokeDasharray="3 8" markerEnd={`url(#${id}-arrow)`} />
      <circle cx="635" cy="486" r="253" fill={`url(#${id}-sun-halo)`} className="solar-halo" />
      <g className="sun-light-rays" stroke={`url(#${id}-rays)`} fill="none" strokeWidth=".8">
        {[402, 434, 466, 498, 530].map((y, i) => <path key={y} d={`M ${690 - Math.abs(i - 2) * 5} ${y + 10} L ${930 + Math.abs(i - 2) * 9} ${y - 5}`} />)}
      </g>
      <circle cx="635" cy="486" r="70" fill="#f7b14f" opacity=".28" filter={`url(#${id}-sun-glow)`} />
      <circle cx="635" cy="486" r="57" fill={`url(#${id}-sun)`} />
      <circle cx="635" cy="486" r="57" fill="#d48942" opacity=".2" filter={`url(#${id}-texture)`} />
      <circle cx="635" cy="486" r="58" fill="none" stroke="#ffe5ab" strokeWidth=".7" strokeOpacity=".55" />
      <text x="635" y="588" textAnchor="middle" className="scene-label sun-label">THE SUN</text>
      <text x="789" y="419" textAnchor="middle" className="scene-micro sunlight-label">SUNLIGHT</text>
      <g transform="translate(1050 434)">
        <circle r="196" fill={`url(#${id}-earth-halo)`} />
        <g clipPath={`url(#${id}-globe-clip)`}>
          <circle r="148" fill={`url(#${id}-ocean)`} />
          <g transform={`rotate(${axisTilt})`} className="earth-geography">
            <g fill={`url(#${id}-land)`} stroke="#a7b299" strokeWidth=".6" strokeOpacity=".23">
              <path d="M-114-80-91-97-67-105-48-109-23-103-7-91-19-80-11-68-22-58-39-52-52-32-64-24-77-38-98-47-111-63Z" />
              <path d="M-68-22-51-17-38 2-24 14-30 34-24 49-37 72-48 93-66 110-72 105-69 78-82 51-81 22-91 3Z" />
              <path d="M-3-90 11-99 29-105 43-97 50-88 67-89 84-81 105-76 129-52 145-25 137-9 117-13 101-27 86-17 69-25 54-19 41-36 28-31 20-47 6-45-1-58 7-70-6-78Z" />
              <path d="M13-37 29-31 44-16 51 8 43 21 39 42 22 68 10 79 1 68-3 41-17 24-29 2-23-18-5-32Z" />
              <path d="M70 6 82 20 88 32 85 51 74 35 68 22Z" />
              <path d="M99 66 119 53 136 61 153 77 136 101 107 104 96 87Z" />
              <path d="M-33-127-9-142 10-145 8-125-10-108-23-110Z" />
              <path d="M-72 135-38 124-10 128 14 124 46 132 75 132 91 145-93 150Z" fill="#acbfc1" />
              <path d="M48 64 52 77 47 87 43 79Z" />
            </g>
            <g stroke="#b9d0d1" fill="none" strokeLinecap="round" opacity=".19">
              <path d="M-140-37C-105-68-76-59-43-57S5-53 19-64" strokeWidth="7" />
              <path d="M-151 61C-120 44-107 52-91 74S-29 90-2 80" strokeWidth="5" />
              <path d="M31-111C66-108 65-96 102-104" strokeWidth="6" />
              <path d="M58 25C79 4 102 23 138 7" strokeWidth="5" />
              <path d="M-108 111C-39 93 23 122 74 110" strokeWidth="4" />
            </g>
            <ellipse rx="148" ry="35" fill="none" stroke="#efdec1" strokeOpacity=".36" strokeWidth=".9" strokeDasharray="4 5" />
            <path d="M-141-48Q0 7 141-48M-141 48Q0 103 141 48" fill="none" stroke="#cfdbd3" strokeOpacity=".12" strokeWidth=".7" />
          </g>
          <circle r="148" opacity=".13" fill="#99a899" filter={`url(#${id}-texture)`} />
          <circle r="149" fill={`url(#${id}-night)`} />
        </g>
        <circle r="148" fill="none" stroke="#90afb4" strokeOpacity=".34" strokeWidth="1" />
        <path d="M-128-75A148 148 0 0 0-133 65" fill="none" stroke="#e3cdae" strokeOpacity=".55" strokeWidth="1.4" />
        <path d="M0-198V-153" stroke="#a6abb0" strokeOpacity=".3" strokeWidth=".9" strokeDasharray="3 5" />
        <path d={`M0-185 A185 185 0 0 ${summer ? 0 : 1} ${Math.sin(axisTilt * Math.PI / 180) * 185} ${-Math.cos(axisTilt * Math.PI / 180) * 185}`} fill="none" stroke="#d6ba86" strokeWidth="1.2" />
        <g transform={`rotate(${axisTilt})`} className="earth-axis">
          <path d="M0-202V-145M0 145V195" stroke="#e4c394" strokeWidth="1.5" />
          <path d="M0-146V147" stroke="#e4c394" strokeWidth=".7" strokeOpacity=".3" strokeDasharray="3 5" />
          <circle cy="-202" r="3" fill="#f3d8aa" />
          <text x="0" y="-219" textAnchor="middle" className="axis-letter">N</text>
          <text x="0" y="214" textAnchor="middle" className="axis-letter">S</text>
        </g>
        <text x={summer ? -45 : 50} y="-220" textAnchor="middle" className="tilt-value">{scene.tilt}°</text>
        <path d="M98-168H151L169-181" stroke="#859498" strokeWidth=".7" strokeOpacity=".5" fill="none" />
        <text x="167" y="-194" textAnchor="end" className="scene-micro axis-caption">AXIAL TILT</text>
      </g>
      <text x="1050" y="689" textAnchor="middle" className="scene-label">EARTH</text>
      <text x="1050" y="713" textAnchor="middle" className="scene-note">{summer ? 'Northern hemisphere · summer' : 'Northern hemisphere · winter'}</text>
      <g className="orbit-indicator" style={{ animationPlayState: paused || reducedMotion ? 'paused' : 'running' }}><circle cx="782" cy="628" r="3" fill="#aabcbe" /><circle cx="782" cy="628" r="7" fill="none" stroke="#aabcbe" strokeOpacity=".2" /></g>
      <text x="762" y="669" className="scene-micro" textAnchor="middle">ONE ORBIT · ONE YEAR</text>
    </svg>
    <div className="season-controls" aria-label="Explore Earth's axial tilt">
      <span className="scene-control-label">A change in perspective</span>
      <div className="season-switch"><button type="button" aria-pressed={summer} onClick={() => setSeason('june')}>June solstice</button><button type="button" aria-pressed={!summer} onClick={() => setSeason('december')}>December solstice</button></div>
    </div>
    <p className="scene-scale-note">Illustrative scale · Northern hemisphere</p>
  </div>;
}

function AccelerationScene({ scene, paused, reducedMotion }: { scene: Extract<SceneSpec, { kind: 'acceleration' }>; paused: boolean; reducedMotion: boolean }) {
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const clock = useRef(0);
  const [cycle, setCycle] = useState(0);
  const small = useSmallViewport();
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    if (paused || reducedMotion) return;
    let frame = 0;
    let previous = 0;
    const tick = (now: number) => {
      if (previous) clock.current += Math.min((now - previous) / 1000, .08) * rate;
      previous = now;
      if (clock.current > scene.duration + 2.4) clock.current = 0;
      setTime(Math.min(clock.current, scene.duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, reducedMotion, rate, scene.duration, cycle]);
  const visibleTime = reducedMotion ? scene.duration : time;
  const fraction = visibleTime / scene.duration;
  const distance = .5 * scene.acceleration * visibleTime * visibleTime;
  const speed = scene.acceleration * visibleTime;
  const from = 200;
  const length = 1030;
  const position = from + fraction * fraction * length;
  const replay = () => { clock.current = 0; setTime(0); setCycle(c => c + 1); };
  return <div className="scene acceleration-scene">
    <div className="kinetic-readout" aria-label={`Acceleration ${scene.acceleration} meters per second squared`}>
      <span className="readout-kicker">A CONSTANT PUSH</span><span className="readout-value">+{scene.acceleration}<small>m/s</small><sup>2</sup></span><span className="readout-note">Every second, a little faster.</span>
    </div>
    <svg className="scene-art acceleration-art" viewBox={small ? '145 285 1120 335' : '0 0 1440 950'} role="img" aria-label={`A ball accelerates from rest at ${scene.acceleration} meters per second squared. Markers are equally spaced in time, and farther apart in distance. After ${scene.duration} seconds it has traveled ${(.5 * scene.acceleration * scene.duration ** 2).toFixed(0)} meters.`}>
      <defs>
        <radialGradient id={`${id}-ball`} cx="32%" cy="26%"><stop stopColor="#da916c" /><stop offset=".45" stopColor="#bd6748" /><stop offset="1" stopColor="#793d2f" /></radialGradient>
        <linearGradient id={`${id}-trail`}><stop stopColor="#b76242" stopOpacity="0" /><stop offset="1" stopColor="#b76242" stopOpacity=".35" /></linearGradient>
        <filter id={`${id}-shadow`}><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <path d="M175 516H1270" stroke="#8b8474" strokeOpacity=".28" strokeWidth="1" />
      <path d="M1263 512 1271 516 1263 520" fill="none" stroke="#8b8474" strokeOpacity=".5" />
      {Array.from({ length: 6 }, (_, i) => {
        const x = from + (i / 5) ** 2 * length;
        const at = scene.duration * i / 5;
        return <g key={i}>
          <line x1={x} x2={x} y1="510" y2="525" stroke="#8b8474" strokeOpacity=".5" />
          {i > 0 && <circle cx={x} cy="475" r="20" fill="none" stroke="#b9856d" strokeOpacity={at <= visibleTime ? '.4' : '.18'} strokeDasharray="2 4" />}
          <text x={x} y="555" textAnchor="middle" className="interval-label">{at.toFixed(at % 1 ? 1 : 0)}<tspan className="interval-unit"> s</tspan></text>
          {i > 0 && <text x={x} y="580" textAnchor="middle" className="interval-distance">{(.5 * scene.acceleration * at ** 2).toFixed(1)} m</text>}
        </g>;
      })}
      <path d={`M${Math.max(from, position - 110)} 475H${position}`} stroke={`url(#${id}-trail)`} strokeWidth="3" />
      <ellipse cx={position} cy="508" rx="27" ry="4" fill="#67523c" opacity=".2" filter={`url(#${id}-shadow)`} />
      <circle cx={position} cy="475" r="22" fill={`url(#${id}-ball)`} />
      <circle cx={position - 6} cy="468" r="5" fill="#e9b191" opacity=".3" />
      <path d={`M${position - 5} 433h${20 + 44 * fraction}m-7-5 7 5-7 5`} stroke="#9d6044" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity=".7" />
      <text x="720" y="648" textAnchor="middle" className="kinetic-diagram-caption">EQUAL TIME. GREATER DISTANCE.</text>
    </svg>
    <div className="motion-observations" aria-hidden="true"><div><span>TIME</span><strong>{visibleTime.toFixed(1)}<small>s</small></strong></div><div><span>SPEED</span><strong>{speed.toFixed(1)}<small>m/s</small></strong></div><div><span>DISTANCE</span><strong>{distance.toFixed(1)}<small>m</small></strong></div></div>
    <div className="kinetic-controls"><button type="button" onClick={replay} disabled={reducedMotion} aria-label="Replay acceleration"><span aria-hidden="true">↻</span> Replay</button><button type="button" onClick={() => setRate(r => r === 1 ? .5 : 1)} disabled={reducedMotion} aria-label={rate === 1 ? 'Play at half speed' : 'Play at normal speed'}>{rate === 1 ? '½' : '1×'}<span>{rate === 1 ? 'Slow down' : 'Normal speed'}</span></button>{reducedMotion && <span className="motion-static-note">Motion reduced · final position shown</span>}</div>
  </div>;
}

function RippleScene() {
  const id = useId().replace(/:/g, '');
  return <div className="scene ripple-scene" aria-hidden="true"><svg className="scene-art ripple-art" viewBox="0 0 1440 950" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#252f39" stopOpacity="0" /><stop offset=".22" stopColor="#222e39" stopOpacity=".7" /><stop offset="1" stopColor="#131d2a" /></linearGradient>
      <radialGradient id={`${id}-dusk`}><stop stopColor="#d8a59c" stopOpacity=".28" /><stop offset="1" stopColor="#916a74" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-horizon`}><stop stopColor="#9f8390" stopOpacity="0" /><stop offset=".5" stopColor="#c6a5a0" stopOpacity=".23" /><stop offset="1" stopColor="#9f8390" stopOpacity="0" /></linearGradient>
    </defs>
    <ellipse cx="750" cy="360" rx="650" ry="340" fill={`url(#${id}-dusk)`} />
    <path d="M0 482Q182 469 319 478T620 477Q841 461 986 480T1440 473V950H0Z" fill={`url(#${id}-water)`} />
    <path d="M0 478Q302 488 639 477T1440 480" stroke={`url(#${id}-horizon)`} fill="none" />
    {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M ${20 + (i % 3) * 70} ${511 + i * 31} Q 480 ${495 + i * 32} 720 ${512 + i * 31} T ${1430 - (i % 4) * 80} ${510 + i * 31}`} fill="none" stroke="#baa8af" strokeOpacity={.016 + i * .002} strokeWidth="1" className="water-line" style={{ animationDelay: `${i * -.7}s` }} />)}
    {[0, 1, 2, 3].map(i => <ellipse key={i} cx="720" cy="677" rx={48 + i * 49} ry={8 + i * 9} stroke="#c2a8aa" strokeWidth=".8" strokeOpacity={.22 - i * .035} fill="none" className="poem-ripple" style={{ animationDelay: `${i * -2}s` }} />)}
    <circle cx="720" cy="677" r="2" fill="#d9bbb8" opacity=".3" />
  </svg><p className="ripple-whisper">A moment passes. Something remains.</p></div>;
}

export function SceneRenderer({ payload, paused, reducedMotion }: RendererContext) {
  const scene = payload as SceneSpec;
  if (scene.kind === 'seasons') return <SeasonsScene scene={scene} paused={paused} reducedMotion={reducedMotion} />;
  if (scene.kind === 'acceleration') return <AccelerationScene scene={scene} paused={paused} reducedMotion={reducedMotion} />;
  return <RippleScene />;
}
