import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { COVERAGE_KEY } from "../../src/coverage";
import { consumeCoverageMessage, type CoverageMessage } from "../../src/index";
import { normalizeEtag } from "../../src/ram";
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

async function gameplayPage(): Promise<{ html: string; headers: Headers }> {
  const page = await exports.default.fetch("https://logansquarelabs.com/gameplay/");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/html");
  const html = await page.text();
  expect(html).not.toContain("<script");
  expect(html).not.toContain("/api/gameplay");
  expect(html).not.toContain("gameplay.js");
  expect(html).not.toMatch(/datasets|website-sml-coverage|raw\/skyemu|CLOUDFLARE|Bearer/i);
  return { html, headers: page.headers };
}

function row(html: string, level: string): string {
  const match = new RegExp(`<li data-level="${level}">[\\s\\S]*?</li>`).exec(html);
  expect(match, level).not.toBeNull();
  return match?.[0] ?? "";
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

    const { html } = await gameplayPage();
    expect(html).toContain("Seconds recorded");
    expect(row(html, "1-1")).toContain('data-pct="100"');
    expect(row(html, "1-1")).toContain(">0.033<");
    expect(row(html, "3-2")).toContain('data-pct="52"');
    expect(row(html, "3-2")).toContain(">0.017<");

    const stored = await env.DATASETS.get(COVERAGE_KEY);
    expect(stored).not.toBeNull();
    expect(COVERAGE_KEY.startsWith("raw/skyemu/")).toBe(false);
    const document = await stored!.json<{
      levels: { level: string; value: number; label: string }[];
      objects: Record<string, { etag: string }>;
    }>();
    expect(document.objects[SML_RAM_KEY]?.etag).toBe(normalizeEtag(etag));
    expect(document.levels.find((level) => level.level === "1-1")?.value).toBe(Math.round(2000 / 60) / 1000);
    expect(document.levels.find((level) => level.level === "3-2")?.label).toBe("0.017");

    const before = await env.DATASETS.head(COVERAGE_KEY);
    const third = message(SML_RAM_KEY, etag);
    await consumeCoverageMessage(env, third);
    const after = await env.DATASETS.head(COVERAGE_KEY);
    expect(after?.etag).toBe(before?.etag);
  });

  it("replaces totals when the same object is uploaded again", async () => {
    const firstEtag = await putRam(SML_RAM_KEY, [0x11], 60);
    await consumeCoverageMessage(env, message(SML_RAM_KEY, firstEtag));
    const secondEtag = await putRam(SML_RAM_KEY, [0x41, 0x41], 60);
    expect(secondEtag).not.toBe(firstEtag);
    await consumeCoverageMessage(env, message(SML_RAM_KEY, secondEtag));

    const { html } = await gameplayPage();
    expect(row(html, "1-1")).toContain('data-pct="0"');
    expect(row(html, "1-1")).toContain(">0.0<");
    expect(row(html, "4-1")).toContain('data-pct="100"');
    expect(row(html, "4-1")).toContain(">0.033<");
  });

  it("ignores Super Mario Land 2 recordings", async () => {
    const etag = await putRam(SML2_KEY, [0x32], 60);
    const notice = message(SML2_KEY, etag);
    await consumeCoverageMessage(env, notice);
    expect(notice.acked).toBe(true);
    const { html } = await gameplayPage();
    expect(html).toContain('data-pct="0"');
    expect(html).not.toMatch(/data-pct="(?!0")/);
    expect(await env.DATASETS.head(COVERAGE_KEY)).toBeNull();
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
    const { html, headers } = await gameplayPage();
    expect(headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(html).toContain("Frames recorded");
    expect(row(html, "1-3")).toContain('data-pct="100"');
    expect(row(html, "1-3")).toContain(">2<");
    expect(html).toContain('href="/style.css"');
    const api = await exports.default.fetch("https://logansquarelabs.com/api/gameplay");
    expect(api.status).toBe(404);
  });
});
