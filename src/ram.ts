/**
 * World-level decode for SkyEmu Super Mario Land RAM recordings.
 *
 * The Worker cannot import the Python decoder, so this is the same mapping:
 * `SkyEmu/tools/ram_state/snapshot.py` (`blob_offset`) and the `world_level`
 * enum in `SkyEmu/ram_maps/super_mario_land.yaml` (bus address `0xFFB4`).
 * Unknown bytes follow the decoder and are not a named stage, so they are
 * not counted. `test/unit/decoder-parity.test.ts` checks the table against
 * `RamLayout` when the research checkout is available.
 */

export const SNAPSHOT_SIZE = 8319;
export const WORLD_LEVEL_OFFSET = 8244;

export const WORLD_LEVELS = [
  "1-1",
  "1-2",
  "1-3",
  "2-1",
  "2-2",
  "2-3",
  "3-1",
  "3-2",
  "3-3",
  "4-1",
  "4-2",
  "4-3",
] as const;

export type WorldLevel = (typeof WORLD_LEVELS)[number];
export type Frames = Record<WorldLevel, number>;

const WORLD_LEVEL_BY_BYTE: ReadonlyMap<number, WorldLevel> = new Map([
  [0x11, "1-1"],
  [0x12, "1-2"],
  [0x13, "1-3"],
  [0x21, "2-1"],
  [0x22, "2-2"],
  [0x23, "2-3"],
  [0x31, "3-1"],
  [0x32, "3-2"],
  [0x33, "3-3"],
  [0x41, "4-1"],
  [0x42, "4-2"],
  [0x43, "4-3"],
]);

const RAM_KEY = /^raw\/skyemu\/([^/]+)\.ram\.bin(?:\.gz)?$/;

export class PermanentIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentIngestError";
  }
}

export function emptyFrames(): Frames {
  return {
    "1-1": 0,
    "1-2": 0,
    "1-3": 0,
    "2-1": 0,
    "2-2": 0,
    "2-3": 0,
    "3-1": 0,
    "3-2": 0,
    "3-3": 0,
    "4-1": 0,
    "4-2": 0,
    "4-3": 0,
  };
}

export function worldLevelLabel(byte: number): WorldLevel | null {
  return WORLD_LEVEL_BY_BYTE.get(byte) ?? null;
}

export function isSuperMarioLandRamKey(key: string): boolean {
  const match = RAM_KEY.exec(key);
  if (!match) return false;
  const name = match[1].toLowerCase();
  if (
    name.includes("mario_land_2") ||
    name.includes("marioland2") ||
    name.includes("marioland_2") ||
    name.includes("golden_coins")
  ) {
    return false;
  }
  return name.includes("mario_land") || name.includes("marioland");
}

export function actionsKeyFor(ramKey: string): string {
  return ramKey.replace(/\.ram\.bin(?:\.gz)?$/, ".actions.jsonl");
}

export function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replaceAll('"', "");
}

export async function countWorldLevels(
  stream: ReadableStream<Uint8Array>,
  compressed: boolean,
): Promise<Frames> {
  const source = compressed
    ? stream.pipeThrough(new DecompressionStream("gzip"))
    : stream;
  const reader = source.getReader();
  const counts = emptyFrames();
  let buffer = new Uint8Array(SNAPSHOT_SIZE + 65536);
  let start = 0;
  let end = 0;

  const append = (chunk: Uint8Array): void => {
    if (start > 0 && end + chunk.length > buffer.length) {
      buffer.copyWithin(0, start, end);
      end -= start;
      start = 0;
    }
    if (end + chunk.length > buffer.length) {
      const next = new Uint8Array(Math.max(buffer.length * 2, end - start + chunk.length));
      next.set(buffer.subarray(start, end), 0);
      buffer = next;
      end -= start;
      start = 0;
    }
    buffer.set(chunk, end);
    end += chunk.length;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) append(value);
      while (end - start >= SNAPSHOT_SIZE) {
        const label = worldLevelLabel(buffer[start + WORLD_LEVEL_OFFSET] ?? 0);
        if (label) counts[label] += 1;
        start += SNAPSHOT_SIZE;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (end - start !== 0) {
    throw new PermanentIngestError(
      "RAM blob length is not a multiple of the snapshot size",
    );
  }
  return counts;
}

type ActionsBucket = {
  get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
};

export async function readRecordingFps(
  bucket: ActionsBucket,
  ramKey: string,
): Promise<number | null> {
  const object = await bucket.get(actionsKeyFor(ramKey));
  if (!object) return null;
  const reader = object.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (!text.includes("\n") && total < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The first line may already have closed the reader.
    }
  }
  text += decoder.decode();
  const line = text.split("\n", 1)[0]?.trim();
  if (!line) return null;
  try {
    const meta: unknown = JSON.parse(line);
    if (!meta || typeof meta !== "object") return null;
    const record = meta as { type?: unknown; fps?: unknown };
    if (record.type !== "meta") return null;
    if (typeof record.fps !== "number" || !Number.isFinite(record.fps) || record.fps <= 0) {
      return null;
    }
    return record.fps;
  } catch {
    return null;
  }
}
