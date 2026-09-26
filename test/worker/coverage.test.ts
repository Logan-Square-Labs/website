import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { consumeCoverageMessage, type CoverageMessage } from "../../src/index";
import { actionsMeta, concatSnapshots, gzipBytes, SML_RAM_KEY } from "../helpers";

const SML2_KEY =
  "raw/skyemu/Super_Mario_Land_2_-_6_Golden_Coins_USA_Europe.41aaad9a-38fa-4246-b168-c6e345efc016.0001.ram.bin.gz";

afterEach(async () => {
  await reset();
});

function message(key: string, etag: string, attempts = 1): CoverageMessage & { acked: boolean; retried: boolean } {
  const record = {
    acked: false,
    retried: false,
    attempts,
    body: {
      account: "test",
      action: "PutObject",
      bucket: "datasets",
      object: { key, size: 1, eTag: etag },
      eventTime: "2026-09-26T00:00:00.000Z",
    },
    ack() {
      record.acked = true;
    },
    retry() {
      record.retried = true;
    },
  };
  return record;
}

async function putRam(key: string, worldBytes: number[], fps: number | null): Promise<string> {
  const gzipped = await gzipBytes(concatSnapshots(worldBytes));
  const stored = await env.DATASETS.put(key, gzipped);
  if (!stored) throw new Error(`failed to store ${key}`);
  if (fps != null) {
    await env.DATASETS.put(key.replace(/\.ram\.bin\.gz$/, ".actions.jsonl"), actionsMeta(fps));
  }
  return stored.etag;
}

describe("upload aggregation", () => {
  it("counts seconds per world-level and does not double-count a retry", async () => {
    const etag = await putRam(SML_RAM_KEY, [0x11, 0x11, 0x32], 60);
    const first = message(SML_RAM_KEY, etag);
    await consumeCoverageMessage(env, first);
    const second = message(SML_RAM_KEY, etag);
    await consumeCoverageMessage(env, second);

    expect(first.acked).toBe(true);
    expect(second.acked).toBe(true);
    expect(second.retried).toBe(false);

    const response = await exports.default.fetch("https://logansquarelabs.com/api/gameplay");
    expect(response.status).toBe(200);
    const chart = await response.json<{
      unit: string;
      unitLabel: string;
      levels: { level: string; value: number; label: string }[];
    }>();
    expect(chart.unit).toBe("seconds");
    expect(chart.unitLabel).toBe("Seconds recorded");
    const oneOne = chart.levels.find((level) => level.level === "1-1");
    const threeTwo = chart.levels.find((level) => level.level === "3-2");
    expect(oneOne?.value).toBe(Math.round(2000 / 60) / 1000);
    expect(threeTwo?.value).toBe(Math.round(1000 / 60) / 1000);
    expect(oneOne?.label).toBe("0.033");
    expect(threeTwo?.label).toBe("0.017");
  });

  it("replaces totals when the same object is uploaded again", async () => {
    const firstEtag = await putRam(SML_RAM_KEY, [0x11], 60);
    await consumeCoverageMessage(env, message(SML_RAM_KEY, firstEtag));
    const secondEtag = await putRam(SML_RAM_KEY, [0x41, 0x41], 60);
    expect(secondEtag).not.toBe(firstEtag);
    await consumeCoverageMessage(env, message(SML_RAM_KEY, secondEtag));

    const chart = await (
      await exports.default.fetch("https://logansquarelabs.com/api/gameplay")
    ).json<{ levels: { level: string; value: number }[] }>();
    expect(chart.levels.find((level) => level.level === "1-1")?.value).toBe(0);
    expect(chart.levels.find((level) => level.level === "4-1")?.value).toBe(Math.round(2000 / 60) / 1000);
  });

  it("ignores Super Mario Land 2 recordings", async () => {
    const etag = await putRam(SML2_KEY, [0x32], 60);
    const notice = message(SML2_KEY, etag);
    await consumeCoverageMessage(env, notice);
    expect(notice.acked).toBe(true);
    const chart = await (
      await exports.default.fetch("https://logansquarelabs.com/api/gameplay")
    ).json<{ levels: { value: number }[] }>();
    expect(chart.levels.every((level) => level.value === 0)).toBe(true);
  });

  it("acks a truncated ram object without retrying", async () => {
    const key = SML_RAM_KEY.replace(".ram.bin.gz", ".ram.bin");
    const stored = await env.DATASETS.put(key, new Uint8Array([1, 2, 3]));
    if (!stored) throw new Error(`failed to store ${key}`);
    const notice = message(key, stored.etag);
    await consumeCoverageMessage(env, notice);
    expect(notice.acked).toBe(true);
    expect(notice.retried).toBe(false);
  });

  it("renders the chart in the site page and falls back to frames without timing", async () => {
    const etag = await putRam(SML_RAM_KEY, [0x13, 0x13], null);
    await consumeCoverageMessage(env, message(SML_RAM_KEY, etag));
    const page = await exports.default.fetch("https://logansquarelabs.com/gameplay/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await page.text();
    expect(html).toContain("Frames recorded");
    expect(html).toContain('data-level="1-3"');
    expect(html).toContain(">2<");
    expect(html).toContain('src="/gameplay.js"');
    expect(html).toContain('href="/style.css"');
  });

  it("backfill is idempotent", async () => {
    await putRam(SML_RAM_KEY, [0x22], 60);
    const id = env.GAMEPLAY_COVERAGE.idFromName("super-mario-land");
    const stub = env.GAMEPLAY_COVERAGE.get(id);
    const first = await stub.backfill();
    const second = await stub.backfill();
    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
    const chart = await stub.chart();
    expect(chart.levels.find((level) => level.level === "2-2")?.value).toBe(Math.round(1000 / 60) / 1000);
  });
});
