import { SNAPSHOT_SIZE, WORLD_LEVEL_OFFSET } from "../src/ram";

export function snapshot(worldByte: number): Uint8Array {
  const bytes = new Uint8Array(SNAPSHOT_SIZE);
  bytes[WORLD_LEVEL_OFFSET] = worldByte;
  return bytes;
}

export function concatSnapshots(worldBytes: number[]): Uint8Array {
  const out = new Uint8Array(SNAPSHOT_SIZE * worldBytes.length);
  worldBytes.forEach((value, index) => {
    out.set(snapshot(value), index * SNAPSHOT_SIZE);
  });
  return out;
}

export async function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function chunked(data: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.byteLength) {
        controller.close();
        return;
      }
      const next = Math.min(offset + size, data.byteLength);
      controller.enqueue(data.subarray(offset, next));
      offset = next;
    },
  });
}

export const SML_RAM_KEY =
  "raw/skyemu/Super_Mario_Land_USA.41aaad9a-38fa-4246-b168-c6e345efc016.0000.ram.bin.gz";

export function actionsMeta(fps: number): string {
  return `${JSON.stringify({
    type: "meta",
    rom: "Super Mario Land (USA)",
    fps,
    ram_format: "gb_wram_hram_v1",
    bytes_per_ram: SNAPSHOT_SIZE,
  })}\n`;
}
