'use client';

import { useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Square } from 'lucide-react';
import type { MatchData } from '@/lib/data/team-documents';
import { Section } from './primitives';

// Path colour runs from the start of auto (teleop cyan) to the end (endgame violet): phase tokens, never the brand accent.

const ROBOT_SIZE = 30;
const FIELD_LENGTH_FT = 27.135;
const DEFAULT_SPEED_FT_PER_S = 10;

interface Point { x: number; y: number }
interface Segment { p1: Point; p2: Point; length: number; angle: number; startDist: number }
type Marker = NonNullable<NonNullable<MatchData['auto']>['markers']>[number];

const markerColor = (type: Marker['type']) => (type === 'pickup' ? 'var(--teleop)' : 'var(--endgame)');
const cleanNumberInput = (text: string) => text.replace(/[^0-9.]/g, '');

function pathColor(ratio: number) {
  const share = Math.max(0, Math.min(1, ratio));
  return `color-mix(in oklab, var(--endgame) ${Math.round(share * 100)}%, var(--teleop))`;
}

/** Straight segments of the drawn SVG paths (`M x,y L x,y ...`, in 0..1 coordinates), scaled to the canvas. */
function parseSegments(paths: string[], width: number, height: number): { segments: Segment[]; totalDist: number } {
  const segments: Segment[] = [];
  let travelled = 0;
  for (const path of paths) {
    let last: Point | null = null;
    for (const [, command, x, y] of path.matchAll(/([ML])\s*([\d.]+),([\d.]+)/gi)) {
      const point = { x: parseFloat(x) * width, y: parseFloat(y) * height };
      if (last && command.toUpperCase() !== 'M') {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        segments.push({ p1: last, p2: point, length, angle: Math.atan2(dy, dx) * (180 / Math.PI), startDist: travelled });
        travelled += length;
      }
      last = point;
    }
  }
  return { segments, totalDist: travelled };
}

/** Where the robot is after driving `distance` along the path. */
function robotPose(segments: Segment[], distance: number) {
  const seg = segments.find((s) => distance >= s.startDist && distance <= s.startDist + s.length) || segments[segments.length - 1];
  const ratio = seg.length === 0 ? 0 : Math.max(0, distance - seg.startDist) / seg.length;
  return { x: seg.p1.x + ratio * (seg.p2.x - seg.p1.x), y: seg.p1.y + ratio * (seg.p2.y - seg.p1.y), angle: seg.angle };
}

/** Advances the distance on every animation frame at `velocityPx` per second; stops itself at the end of the path. */
function animate(velocityPx: number, totalDist: number, setDistance: (update: (distance: number) => number) => void, onFinish: () => void) {
  let reqId: number;
  let lastTime = Date.now();
  const tick = () => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    setDistance((prev) => {
      const next = prev + velocityPx * dt;
      if (next < totalDist) return next;
      onFinish();
      return totalDist;
    });
    reqId = requestAnimationFrame(tick);
  };
  reqId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(reqId);
}

/** Replay state: how far along the path the robot is, advanced by animation frames while playing. */
function usePlayback(totalDist: number, pixelsPerFoot: number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [distance, setDistance] = useState(0);
  const [velocity, setVelocity] = useState(String(DEFAULT_SPEED_FT_PER_S));

  useEffect(() => {
    if (!isPlaying) return;
    const velocityPx = (parseFloat(velocity) || DEFAULT_SPEED_FT_PER_S) * pixelsPerFoot;
    return animate(velocityPx, totalDist, setDistance, () => setIsPlaying(false));
  }, [isPlaying, velocity, totalDist, pixelsPerFoot]);

  const play = () => {
    if (distance >= totalDist && totalDist > 0) setDistance(0);
    setIsPlaying(true);
  };
  const restart = () => { setDistance(0); setIsPlaying(false); };
  return { isPlaying, distance, velocity, setVelocity: (text: string) => setVelocity(cleanNumberInput(text)), play, stop: () => setIsPlaying(false), restart };
}

interface AutoPathProps { match: MatchData; canvasWidth?: number; canvasHeight?: number }

export function AutoPathVisualization({ match, canvasWidth = 520, canvasHeight = 355 }: AutoPathProps) {
  const [showViewer, setShowViewer] = useState(true);
  const { segments, totalDist } = useMemo(() => parseSegments(match?.auto?.paths || [], canvasWidth, canvasHeight), [match, canvasWidth, canvasHeight]);
  const playback = usePlayback(totalDist, canvasWidth / FIELD_LENGTH_FT);

  const toggleViewer = () => {
    if (showViewer) playback.stop();
    setShowViewer(!showViewer);
  };

  return (
    <Section
      title="Auto Path"
      aside={<button type="button" onClick={toggleViewer} className="text-sm font-medium text-accent-text hover:underline">{showViewer ? 'Hide Auto Path Viewer' : 'Show Auto Path Viewer'}</button>}
    >
      <div className="p-4 sm:p-5">
        {showViewer && <PlaybackControls playback={playback} />}
        <FieldCanvas match={match} width={canvasWidth} height={canvasHeight} segments={segments} totalDist={totalDist} showRobot={showViewer && segments.length > 0} distance={playback.distance} />
        <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teleop" />P = pickup</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-endgame" />S = scoring</li>
          <li className="flex items-center gap-1.5"><span className="h-1 w-6 rounded-full bg-gradient-to-r from-teleop to-endgame" />path start → end</li>
        </ul>
      </div>
    </Section>
  );
}

const smallButton = 'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors';

function PlaybackControls({ playback: { isPlaying, velocity, setVelocity, play, stop, restart } }: { playback: ReturnType<typeof usePlayback> }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <SpeedInput value={velocity} onChange={setVelocity} />
      <div className="flex gap-2">
        {isPlaying ? (
          <button type="button" onClick={stop} className={`${smallButton} border-bad/40 text-bad hover:bg-bad-soft`}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button type="button" onClick={play} className={`${smallButton} border-accent bg-accent text-accent-foreground hover:bg-accent-hover`}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Play
          </button>
        )}
        <button type="button" onClick={restart} className={`${smallButton} border-line-strong text-ink hover:bg-surface-2`}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restart
        </button>
      </div>
    </div>
  );
}

function SpeedInput({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Speed
      <input
        className="h-9 w-16 rounded-md border border-line-strong bg-surface px-2 text-center font-mono text-sm text-ink outline-none focus:border-accent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
      ft/s
    </label>
  );
}

interface FieldCanvasProps { match: MatchData; width: number; height: number; segments: Segment[]; totalDist: number; showRobot: boolean; distance: number }

function FieldCanvas({ match, width, height, segments, totalDist, showRobot, distance }: FieldCanvasProps) {
  const flipImage = match?.start?.alliance?.toLowerCase() === 'blue';
  const isFieldFlipped = Boolean(match?.auto?.fieldFlipped);

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-md border border-line bg-surface-2" style={{ maxWidth: width, aspectRatio: `${width} / ${height}` }}>
      <div style={{ width: '100%', height: '100%', transform: `rotate(${isFieldFlipped ? 180 : 0}deg)`, transition: 'transform 420ms cubic-bezier(0.65, 0, 0.35, 1)' }}>
        {/* Field diagram, served from public/field.png */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/field.png" alt="Field" style={{ width: '200%', height: '100%', position: 'absolute', left: flipImage ? '-100%' : 0, top: 0, objectFit: 'cover' }} />
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {segments.map((seg, idx) => (
            <line
              key={`seg-${idx}`}
              x1={seg.p1.x}
              y1={seg.p1.y}
              x2={seg.p2.x}
              y2={seg.p2.y}
              stroke={pathColor(totalDist > 0 ? (seg.startDist + seg.length / 2) / totalDist : 0)}
              strokeWidth={5}
              strokeLinecap="round"
            />
          ))}
          {(match?.auto?.markers || []).map((marker, idx) => <MarkerPin key={`marker-${idx}`} marker={marker} width={width} height={height} />)}
          {showRobot && <Robot pose={robotPose(segments, distance)} label={match?.teamNumber?.toString() || ''} />}
        </svg>
      </div>
    </div>
  );
}

function MarkerPin({ marker, width, height }: { marker: Marker; width: number; height: number }) {
  const x = marker.x * width;
  const y = marker.y * height;
  return (
    <g>
      <circle cx={x} cy={y} r={16} fill={markerColor(marker.type)} stroke="white" strokeWidth={2} />
      <text x={x} y={y + 5} fontSize={14} fontWeight="bold" fill="white" textAnchor="middle">
        {marker.type === 'pickup' ? 'P' : 'S'}
      </text>
    </g>
  );
}

function Robot({ pose, label }: { pose: { x: number; y: number; angle: number }; label: string }) {
  return (
    <g transform={`translate(${pose.x}, ${pose.y}) rotate(${pose.angle})`}>
      <rect x={-ROBOT_SIZE / 2} y={-ROBOT_SIZE / 2} width={ROBOT_SIZE} height={ROBOT_SIZE} fill="rgb(23 25 28 / 0.8)" stroke="var(--ink)" strokeWidth={2} rx={4} />
      <rect x={ROBOT_SIZE / 2 - 4} y={-ROBOT_SIZE / 2} width={4} height={ROBOT_SIZE} fill="var(--ink)" rx={1} />
      <text x={0} y={ROBOT_SIZE / 4 - 2} fontSize={Math.max(10, ROBOT_SIZE * 0.4)} fontWeight="bold" fill="white" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
