import {
  applyUpload,
  emptyChart,
  emptyDocument,
  parseCoverageDocument,
  shouldReplace,
  toPublic,
  type Contribution,
  type CoverageDocument,
  type PublicChart,
} from "./chart";
import {
  countWorldLevels,
  isSuperMarioLandRamKey,
  normalizeEtag,
  PermanentIngestError,
  readRecordingFps,
} from "./ram";

/**
 * Outside `raw/skyemu/` so the object-create notification on that prefix
 * cannot enqueue this file and loop.
 */
export const COVERAGE_KEY = "website/super-mario-land-gameplay.json";

const WRITE_ATTEMPTS = 5;

export type IngestResult =
  | { status: "ignored" | "skipped" | "updated" }
  | { status: "permanent"; reason: string };

type Loaded = {
  doc: CoverageDocument;
  etag: string | null;
};

export async function readChart(bucket: R2Bucket): Promise<PublicChart> {
  const object = await bucket.get(COVERAGE_KEY);
  if (!object) return toPublic(emptyChart());
  const doc = parseCoverageDocument(await object.json());
  if (!doc) throw new Error("coverage document is invalid");
  return {
    game: doc.game,
    unit: doc.unit,
    unitLabel: doc.unitLabel,
    updatedAt: doc.updatedAt,
    levels: doc.levels,
  };
}

export async function ingestObject(
  bucket: R2Bucket,
  key: string,
  etagHint: string,
): Promise<IngestResult> {
  if (!isSuperMarioLandRamKey(key)) return { status: "ignored" };

  const hinted = normalizeEtag(etagHint);
  const loaded = await load(bucket);
  const existing = loaded.doc.objects[key] ?? null;
  if (existing && hinted && existing.etag === hinted) return { status: "skipped" };

  const head = await bucket.head(key);
  if (!head) {
    if (!existing) return { status: "skipped" };
    await commit(bucket, loaded, key, null);
    return { status: "updated" };
  }

  const headed = normalizeEtag(head.etag);
  if (existing?.etag === headed) return { status: "skipped" };
  if (existing && existing.uploadedMs > head.uploaded.getTime()) return { status: "skipped" };

  const object = await bucket.get(key);
  if (!object) {
    if (!existing) return { status: "skipped" };
    await commit(bucket, loaded, key, null);
    return { status: "updated" };
  }

  let contribution: Contribution;
  try {
    const frames = await countWorldLevels(object.body, key.endsWith(".gz"));
    const fps = await readRecordingFps(bucket, key);
    contribution = {
      etag: normalizeEtag(object.etag),
      uploadedMs: object.uploaded.getTime(),
      frames,
      fps,
    };
  } catch (error) {
    if (error instanceof PermanentIngestError) {
      return { status: "permanent", reason: error.message };
    }
    throw error;
  }

  const wrote = await commit(bucket, loaded, key, contribution);
  return { status: wrote ? "updated" : "skipped" };
}

async function load(bucket: R2Bucket): Promise<Loaded> {
  const object = await bucket.get(COVERAGE_KEY);
  if (!object) return { doc: emptyDocument(), etag: null };
  const doc = parseCoverageDocument(await object.json());
  if (!doc) throw new Error("coverage document is invalid");
  return { doc, etag: object.etag };
}

async function commit(
  bucket: R2Bucket,
  loaded: Loaded,
  key: string,
  next: Contribution | null,
): Promise<boolean> {
  let current = loaded;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const previous = current.doc.objects[key] ?? null;
    if (next && !shouldReplace(previous, next)) return false;
    if (!next && !previous) return false;
    const updated = applyUpload(current.doc, key, next, new Date().toISOString());
    const stored = await bucket.put(COVERAGE_KEY, JSON.stringify(updated), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" },
    });
    if (stored) return true;
    current = await load(bucket);
  }
  throw new Error("coverage document changed during update");
}
