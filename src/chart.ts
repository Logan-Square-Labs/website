import { emptyFrames, WORLD_LEVELS, type Frames, type WorldLevel } from "./ram";

export type Contribution = {
  etag: string;
  uploadedMs: number;
  frames: Frames;
  fps: number | null;
};

export type ChartState = {
  frames: Frames;
  durationMs: Frames;
  untimedObjects: number;
  updatedAt: string | null;
};

export type LevelBar = {
  level: WorldLevel;
  value: number;
  label: string;
};

export type PublicChart = {
  game: "super_mario_land";
  unit: "seconds" | "frames";
  unitLabel: "Seconds recorded" | "Frames recorded";
  levels: LevelBar[];
  updatedAt: string | null;
};

export function emptyChart(): ChartState {
  return {
    frames: emptyFrames(),
    durationMs: emptyFrames(),
    untimedObjects: 0,
    updatedAt: null,
  };
}

export function durationMsFor(frames: number, fps: number): number {
  return Math.round((frames * 1000) / fps);
}

export function hasFrames(frames: Frames): boolean {
  return WORLD_LEVELS.some((level) => (frames[level] ?? 0) > 0);
}

export function isUntimed(contribution: Contribution): boolean {
  return contribution.fps == null && hasFrames(contribution.frames);
}

export function shouldReplace(
  existing: Contribution | null,
  next: Contribution,
): boolean {
  if (!existing) return true;
  if (existing.etag === next.etag) return false;
  if (existing.uploadedMs > next.uploadedMs) return false;
  return true;
}

export function formatValue(value: number, unit: PublicChart["unit"]): string {
  if (unit === "frames") return String(Math.max(0, Math.round(value)));
  const text = value.toFixed(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return text.includes(".") ? text : `${text}.0`;
}

export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round((value / max) * 100)));
}

export function applyContribution(
  chart: ChartState,
  previous: Contribution | null,
  next: Contribution | null,
  updatedAt: string,
): ChartState {
  const frames = emptyFrames();
  const durationMs = emptyFrames();
  for (const level of WORLD_LEVELS) {
    frames[level] = chart.frames[level] ?? 0;
    durationMs[level] = chart.durationMs[level] ?? 0;
  }
  let untimedObjects = chart.untimedObjects;

  const subtract = (contribution: Contribution): void => {
    for (const level of WORLD_LEVELS) {
      frames[level] = Math.max(0, frames[level] - (contribution.frames[level] ?? 0));
      if (contribution.fps != null) {
        durationMs[level] = Math.max(
          0,
          durationMs[level] - durationMsFor(contribution.frames[level] ?? 0, contribution.fps),
        );
      }
    }
    if (isUntimed(contribution)) untimedObjects = Math.max(0, untimedObjects - 1);
  };

  const add = (contribution: Contribution): void => {
    for (const level of WORLD_LEVELS) {
      frames[level] += contribution.frames[level] ?? 0;
      if (contribution.fps != null) {
        durationMs[level] += durationMsFor(contribution.frames[level] ?? 0, contribution.fps);
      }
    }
    if (isUntimed(contribution)) untimedObjects += 1;
  };

  if (previous) subtract(previous);
  if (next) add(next);

  return { frames, durationMs, untimedObjects, updatedAt };
}

export function toPublic(state: ChartState): PublicChart {
  const unit = state.untimedObjects > 0 ? "frames" : "seconds";
  const unitLabel = unit === "frames" ? "Frames recorded" : "Seconds recorded";
  return {
    game: "super_mario_land",
    unit,
    unitLabel,
    updatedAt: state.updatedAt,
    levels: WORLD_LEVELS.map((level) => {
      const value = unit === "frames" ? (state.frames[level] ?? 0) : (state.durationMs[level] ?? 0) / 1000;
      return { level, value, label: formatValue(value, unit) };
    }),
  };
}
