import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_SIZE, WORLD_LEVEL_OFFSET, WORLD_LEVELS, worldLevelLabel } from "../../src/ram";

function skyemuRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.SKYEMU_ROOT,
    resolve(here, "../../../research/SkyEmu"),
    resolve(here, "../../../../research/SkyEmu"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "tools/ram_state/decoder.py"))) return candidate;
  }
  return null;
}

describe("Super Mario Land decoder parity", () => {
  const root = skyemuRoot();

  it.skipIf(!root)("matches RamLayout world_level labels", () => {
    const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(resolve(root ?? "", "tools"))})
from ram_state import RamLayout, blob_offset, SNAPSHOT_SIZE
layout = RamLayout.from_yaml(${JSON.stringify(resolve(root ?? "", "ram_maps/super_mario_land.yaml"))})
offset = blob_offset(0xFFB4)
labels = {}
for value in range(256):
    raw = bytearray(SNAPSHOT_SIZE)
    raw[offset] = value
    decoded = layout.decode(bytes(raw))["world_level"]
    if isinstance(decoded, str):
        labels[str(value)] = decoded
print(json.dumps({"offset": offset, "size": SNAPSHOT_SIZE, "labels": labels}))
`;
    const stdout = execFileSync("python3", ["-c", script], { encoding: "utf8" });
    const decoded = JSON.parse(stdout) as {
      offset: number;
      size: number;
      labels: Record<string, string>;
    };
    expect(decoded.offset).toBe(WORLD_LEVEL_OFFSET);
    expect(decoded.size).toBe(SNAPSHOT_SIZE);
    const expected = new Map<number, string>(
      Object.entries(decoded.labels).map(([byte, label]) => [Number(byte), label]),
    );
    expect([...expected.values()].sort()).toEqual([...WORLD_LEVELS].sort());
    for (let byte = 0; byte < 256; byte += 1) {
      expect(worldLevelLabel(byte)).toBe(expected.get(byte) ?? null);
    }
  });
});
