import {
  emptyFrames,
  isSuperMarioLandRamKey,
  WORLD_LEVELS,
  type Frames,
  type WorldLevel,
} from "./ram";

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

export type CoverageDocument = {
  version: 1;
  game: PublicChart["game"];
  unit: PublicChart["unit"];
  unitLabel: PublicChart["unitLabel"];
  updatedAt: string | null;
  levels: LevelBar[];
  objects: Record<string, Contribution>;
};

export function emptyDocument(): CoverageDocument {
  return documentFromObjects({}, null);
}

export function applyUpload(
  doc: CoverageDocument,
  key: string,
  next: Contribution | null,
  updatedAt: string,
): CoverageDocument {
  if (!isSuperMarioLandRamKey(key)) return doc;
  const previous = doc.objects[key] ?? null;
  if (next) {
    if (!shouldReplace(previous, next)) return doc;
  } else if (!previous) {
    return doc;
  }
  const objects: Record<string, Contribution> = {};
  for (const objectKey of Object.keys(doc.objects)) {
    if (objectKey !== key) objects[objectKey] = doc.objects[objectKey];
  }
  if (next) objects[key] = next;
  return documentFromObjects(objects, updatedAt);
}

export function parseCoverageDocument(value: unknown): CoverageDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.game !== "super_mario_land") return null;
  if (record.unit !== "seconds" && record.unit !== "frames") return null;
  const unitLabel = record.unit === "seconds" ? "Seconds recorded" : "Frames recorded";
  if (record.unitLabel !== unitLabel) return null;
  if (record.updatedAt !== null && typeof record.updatedAt !== "string") return null;
  if (!Array.isArray(record.levels) || record.levels.length !== WORLD_LEVELS.length) return null;
  const levels: LevelBar[] = [];
  for (let index = 0; index < WORLD_LEVELS.length; index += 1) {
    const level = record.levels[index];
    if (!level || typeof level !== "object") return null;
    const bar = level as Partial<LevelBar>;
    if (bar.level !== WORLD_LEVELS[index]) return null;
    if (typeof bar.value !== "number" || !Number.isFinite(bar.value)) return null;
    if (typeof bar.label !== "string") return null;
    levels.push({ level: bar.level, value: bar.value, label: bar.label });
  }
  if (!record.objects || typeof record.objects !== "object" || Array.isArray(record.objects)) {
    return null;
  }
  const objects: Record<string, Contribution> = {};
  for (const [key, entry] of Object.entries(record.objects)) {
    const contribution = parseContribution(entry);
    if (!contribution) return null;
    objects[key] = contribution;
  }
  return {
    version: 1,
    game: "super_mario_land",
    unit: record.unit,
    unitLabel,
    updatedAt: record.updatedAt,
    levels,
    objects,
  };
}

function documentFromObjects(
  objects: Record<string, Contribution>,
  updatedAt: string | null,
): CoverageDocument {
  const sorted: Record<string, Contribution> = {};
  let chart = emptyChart();
  for (const key of Object.keys(objects).sort()) {
    const contribution = objects[key];
    sorted[key] = contribution;
    chart = applyContribution(chart, null, contribution, updatedAt ?? "");
  }
  chart = { ...chart, updatedAt };
  const pub = toPublic(chart);
  return { version: 1, ...pub, objects: sorted };
}

function parseContribution(value: unknown): Contribution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Contribution>;
  if (typeof record.etag !== "string" || record.etag.length === 0) return null;
  if (typeof record.uploadedMs !== "number" || !Number.isFinite(record.uploadedMs)) return null;
  if (
    record.fps !== null &&
    (typeof record.fps !== "number" || !Number.isFinite(record.fps) || record.fps <= 0)
  ) {
    return null;
  }
  if (!record.frames || typeof record.frames !== "object") return null;
  const frames = emptyFrames();
  for (const level of WORLD_LEVELS) {
    const count = record.frames[level];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
    frames[level] = count;
  }
  return { etag: record.etag, uploadedMs: record.uploadedMs, frames, fps: record.fps ?? null };
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
