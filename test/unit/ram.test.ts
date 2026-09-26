import { describe, expect, it } from "vitest";
import { applyContribution, emptyChart, formatValue, shouldReplace, toPublic, type Contribution } from "../../src/chart";
import {
  actionsKeyFor,
  countWorldLevels,
  emptyFrames,
  isSuperMarioLandRamKey,
  readRecordingFps,
  SNAPSHOT_SIZE,
  worldLevelLabel,
  WORLD_LEVEL_OFFSET,
} from "../../src/ram";
import { actionsMeta, chunked, concatSnapshots, gzipBytes, SML_RAM_KEY } from "../helpers";

describe("world level bytes", () => {
  it("maps the Super Mario Land enum and ignores unknown bytes", () => {
    expect(WORLD_LEVEL_OFFSET).toBe(8244);
    expect(SNAPSHOT_SIZE).toBe(8319);
    expect(worldLevelLabel(0x32)).toBe("3-2");
    expect(worldLevelLabel(0x11)).toBe("1-1");
    expect(worldLevelLabel(0x43)).toBe("4-3");
    expect(worldLevelLabel(0x00)).toBeNull();
    expect(worldLevelLabel(0x99)).toBeNull();
  });

  it("counts only named stages, including across small reads", async () => {
    const raw = concatSnapshots([0x11, 0x00, 0x32, 0x32, 0x99]);
    const counts = await countWorldLevels(chunked(raw, 100), false);
    expect(counts["1-1"]).toBe(1);
    expect(counts["3-2"]).toBe(2);
    expect(counts["4-1"]).toBe(0);
  });

  it("gunzips a recording and rejects a truncated blob", async () => {
    const gzipped = await gzipBytes(concatSnapshots([0x21, 0x22]));
    const counts = await countWorldLevels(new Blob([gzipped]).stream(), true);
    expect(counts["2-1"]).toBe(1);
    expect(counts["2-2"]).toBe(1);

    const truncated = concatSnapshots([0x11]).subarray(0, 100);
    await expect(countWorldLevels(new Blob([truncated]).stream(), false)).rejects.toThrow(
      /snapshot size/,
    );
  });
});

describe("recording keys", () => {
  it("accepts Super Mario Land ram objects and skips Land 2 and other parts", () => {
    expect(isSuperMarioLandRamKey(SML_RAM_KEY)).toBe(true);
    expect(
      isSuperMarioLandRamKey(
        "raw/skyemu/Super_Mario_Land_2_-_6_Golden_Coins_USA_Europe.41aaad9a-38fa-4246-b168-c6e345efc016.0001.ram.bin.gz",
      ),
    ).toBe(false);
    expect(isSuperMarioLandRamKey(SML_RAM_KEY.replace(".ram.bin.gz", ".frames.bin.gz"))).toBe(false);
    expect(isSuperMarioLandRamKey("raw/skyemu/SUPER_MARIOLAND.session.0000.ram.bin")).toBe(true);
    expect(actionsKeyFor(SML_RAM_KEY)).toBe(
      "raw/skyemu/Super_Mario_Land_USA.41aaad9a-38fa-4246-b168-c6e345efc016.0000.actions.jsonl",
    );
  });
});

describe("frame timing", () => {
  it("reads fps from the actions meta and ignores anything else", async () => {
    const meta = new TextEncoder().encode(actionsMeta(60) + '{"type":"action_state"}\n');
    const bucket = {
      async get() {
        return { body: new Blob([meta]).stream() };
      },
    };
    expect(await readRecordingFps(bucket, SML_RAM_KEY)).toBe(60);

    const missing = { async get() { return null; } };
    expect(await readRecordingFps(missing, SML_RAM_KEY)).toBeNull();
  });
});

describe("aggregate", () => {
  function contribution(etag: string, uploadedMs: number, level: "1-1" | "3-2", frames: number, fps: number | null): Contribution {
    const counts = emptyFrames();
    counts[level] = frames;
    return { etag, uploadedMs, frames: counts, fps };
  }

  it("uses seconds when every object has a frame rate", () => {
    const chart = applyContribution(
      emptyChart(),
      null,
      contribution("a", 1, "1-1", 60, 60),
      "2026-09-26T00:00:00.000Z",
    );
    const pub = toPublic(chart);
    expect(pub.unit).toBe("seconds");
    expect(pub.unitLabel).toBe("Seconds recorded");
    expect(pub.levels.find((level) => level.level === "1-1")).toMatchObject({ value: 1, label: "1.0" });
    expect(formatValue(1 / 60, "seconds")).toBe("0.017");
  });

  it("switches the whole chart to frames when any object has no timing", () => {
    const timed = applyContribution(emptyChart(), null, contribution("a", 1, "1-1", 60, 60), "t");
    const mixed = applyContribution(timed, null, contribution("b", 2, "3-2", 3, null), "t2");
    const pub = toPublic(mixed);
    expect(pub.unit).toBe("frames");
    expect(pub.unitLabel).toBe("Frames recorded");
    expect(pub.levels.find((level) => level.level === "1-1")?.value).toBe(60);
    expect(pub.levels.find((level) => level.level === "3-2")?.value).toBe(3);
  });

  it("replaces an object's contribution instead of adding it twice", () => {
    const first = contribution("a", 1, "1-1", 10, 60);
    const second = contribution("b", 2, "3-2", 5, 60);
    const once = applyContribution(emptyChart(), null, first, "t");
    const replaced = applyContribution(once, first, second, "t2");
    expect(replaced.frames["1-1"]).toBe(0);
    expect(replaced.frames["3-2"]).toBe(5);
    expect(shouldReplace(first, first)).toBe(false);
    expect(shouldReplace(second, first)).toBe(false);
    expect(shouldReplace(first, second)).toBe(true);
  });
});
