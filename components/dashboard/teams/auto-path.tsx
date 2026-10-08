'use client';

import { useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Square } from 'lucide-react';
import type { MatchData } from '@/lib/data/team-documents';
import { Section } from './primitives';

// Path colour runs from the start of auto (teleop cyan) to the end (endgame violet): phase tokens, never the brand accent.

export function AutoPathVisualization({
  match,
  canvasWidth = 520,
  canvasHeight = 355,
}: {
  match: MatchData;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const markers = match?.auto?.markers || [];
  const alliance = match?.start?.alliance?.toLowerCase() || 'red';
  const shouldFlipImage = alliance === 'blue';
  const isFieldFlipped = Boolean(match?.auto?.fieldFlipped);
  const teamNumber = match?.teamNumber?.toString() || '';

  const markerColor = (type: 'pickup' | 'scoring') => (type === 'pickup' ? 'var(--teleop)' : 'var(--endgame)');

  const PIXELS_PER_FOOT = canvasWidth / 27.135;
  const ROBOT_SIZE = 30;

  const [showViewer, setShowViewer] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [distance, setDistance] = useState(0);
  const [velocity, setVelocity] = useState('10');

  const cleanNumberInput = (text: string) => text.replace(/[^0-9.]/g, '');

  const { segments, totalDist } = useMemo(() => {
    const segs: {
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      length: number;
      angle: number;
      startDist: number;
    }[] = [];
    let d = 0;
    const paths = match?.auto?.paths || [];

    paths.forEach((p) => {
      const matchesFound = [...p.matchAll(/([ML])\s*([\d.]+),([\d.]+)/gi)];
      let lastPt: { x: number; y: number } | null = null;
      matchesFound.forEach((m) => {
        const cmd = m[1].toUpperCase();
        const pt = { x: parseFloat(m[2]) * canvasWidth, y: parseFloat(m[3]) * canvasHeight };
        if (lastPt && cmd !== 'M') {
          const dx = pt.x - lastPt.x;
          const dy = pt.y - lastPt.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          segs.push({ p1: lastPt, p2: pt, length: len, angle, startDist: d });
          d += len;
        }
        lastPt = pt;
      });
    });
    return { segments: segs, totalDist: d };
  }, [match, canvasWidth, canvasHeight]);

  const interpolateColor = (ratio: number) => {
    const s = Math.max(0, Math.min(1, ratio));
    return `color-mix(in oklab, var(--endgame) ${Math.round(s * 100)}%, var(--teleop))`;
  };

  useEffect(() => {
    if (!isPlaying) return;
    let reqId: number;
    let lastTime = Date.now();
    const velocityFt = parseFloat(velocity) || 10;
    const velocityPx = velocityFt * PIXELS_PER_FOOT;

    const tick = () => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setDistance((prev) => {
        const next = prev + velocityPx * dt;
        if (next >= totalDist) {
          setIsPlaying(false);
          return totalDist;
        }
        return next;
      });
      reqId = requestAnimationFrame(tick);
    };
    reqId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(reqId);
  }, [isPlaying, velocity, totalDist, PIXELS_PER_FOOT]);

  let robotX = -999;
  let robotY = -999;
  let robotAngle = 0;
  if (segments.length > 0) {
    const seg =
      segments.find((s) => distance >= s.startDist && distance <= s.startDist + s.length) ||
      segments[segments.length - 1];
    const ratio = seg.length === 0 ? 0 : Math.max(0, distance - seg.startDist) / seg.length;
    robotX = seg.p1.x + ratio * (seg.p2.x - seg.p1.x);
    robotY = seg.p1.y + ratio * (seg.p2.y - seg.p1.y);
    robotAngle = seg.angle;
  }

  const smallButton = 'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors';

  return (
    <Section
      title="Auto Path"
     
      aside={
        <button
          type="button"
          onClick={() => {
            if (showViewer) setIsPlaying(false);
            setShowViewer(!showViewer);
          }}
          className="text-sm font-medium text-accent-text hover:underline"
        >
          {showViewer ? 'Hide Auto Path Viewer' : 'Show Auto Path Viewer'}
        </button>
      }
    >
      <div className="p-4 sm:p-5">
        {showViewer && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              Speed
              <input
                className="h-9 w-16 rounded-md border border-line-strong bg-surface px-2 text-center font-mono text-sm text-ink outline-none focus:border-accent"
                value={velocity}
                onChange={(e) => setVelocity(cleanNumberInput(e.target.value))}
                inputMode="decimal"
              />
              ft/s
            </label>
            <div className="flex gap-2">
              {!isPlaying ? (
                <button
                  type="button"
                  onClick={() => {
                    if (distance >= totalDist && totalDist > 0) setDistance(0);
                    setIsPlaying(true);
                  }}
                  className={`${smallButton} border-accent bg-accent text-accent-foreground hover:bg-accent-hover`}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Play
                </button>
              ) : (
                <button type="button" onClick={() => setIsPlaying(false)} className={`${smallButton} border-bad/40 text-bad hover:bg-bad-soft`}>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDistance(0);
                  setIsPlaying(false);
                }}
                className={`${smallButton} border-line-strong text-ink hover:bg-surface-2`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Restart
              </button>
            </div>
          </div>
        )}

        <div
          className="relative mx-auto w-full overflow-hidden rounded-md border border-line bg-surface-2"
          style={{ maxWidth: canvasWidth, aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `rotate(${isFieldFlipped ? 180 : 0}deg)`,
              transition: 'transform 420ms cubic-bezier(0.65, 0, 0.35, 1)',
            }}
          >
            {/* Field diagram, served from public/field.png */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/field.png"
              alt="Field"
              style={{
                width: '200%',
                height: '100%',
                position: 'absolute',
                left: shouldFlipImage ? '-100%' : 0,
                top: 0,
                objectFit: 'cover',
              }}
            />
            <svg width={canvasWidth} height={canvasHeight} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {segments.map((seg, idx) => {
                const ratio = totalDist > 0 ? (seg.startDist + seg.length / 2) / totalDist : 0;
                return (
                  <line
                    key={`seg-${idx}`}
                    x1={seg.p1.x}
                    y1={seg.p1.y}
                    x2={seg.p2.x}
                    y2={seg.p2.y}
                    stroke={interpolateColor(ratio)}
                    strokeWidth={5}
                    strokeLinecap="round"
                  />
                );
              })}

              {markers.map((marker, idx) => {
                const mx = marker.x * canvasWidth;
                const my = marker.y * canvasHeight;
                return (
                  <g key={`marker-${idx}`}>
                    <circle cx={mx} cy={my} r={16} fill={markerColor(marker.type)} stroke="white" strokeWidth={2} />
                    <text x={mx} y={my + 5} fontSize={14} fontWeight="bold" fill="white" textAnchor="middle">
                      {marker.type === 'pickup' ? 'P' : 'S'}
                    </text>
                  </g>
                );
              })}

              {showViewer && segments.length > 0 && (
                <g transform={`translate(${robotX}, ${robotY}) rotate(${robotAngle})`}>
                  <rect
                    x={-ROBOT_SIZE / 2}
                    y={-ROBOT_SIZE / 2}
                    width={ROBOT_SIZE}
                    height={ROBOT_SIZE}
                    fill="rgb(23 25 28 / 0.8)"
                    stroke="var(--ink)"
                    strokeWidth={2}
                    rx={4}
                  />
                  <rect x={ROBOT_SIZE / 2 - 4} y={-ROBOT_SIZE / 2} width={4} height={ROBOT_SIZE} fill="var(--ink)" rx={1} />
                  <text x={0} y={ROBOT_SIZE / 4 - 2} fontSize={Math.max(10, ROBOT_SIZE * 0.4)} fontWeight="bold" fill="white" textAnchor="middle">
                    {teamNumber}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>

        <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teleop" />P = pickup</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-endgame" />S = scoring</li>
          <li className="flex items-center gap-1.5"><span className="h-1 w-6 rounded-full bg-gradient-to-r from-teleop to-endgame" />path start → end</li>
        </ul>
      </div>
    </Section>
  );
}
