/**
 * One-shot tally of Super Mario Land RAM objects already in R2.
 * Writes website/super-mario-land-gameplay.json. Not a cron.
 *
 * Run before the queue consumer that writes this key is deployed. A later run
 * replaces the object with a fresh tally, so do not run it while that consumer
 * is also writing the key.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *     npx tsx scripts/seed-gameplay-coverage.ts
 */

import { applyUpload, emptyDocument, type Contribution } from "../src/chart";
import { COVERAGE_KEY } from "../src/coverage";
import {
  countWorldLevels,
  isSuperMarioLandRamKey,
  normalizeEtag,
  PermanentIngestError,
  readRecordingFps,
} from "../src/ram";

const BUCKET = "datasets";
const PREFIX = "raw/skyemu/";
const DECODE_CONCURRENCY = 4;

type ListedObject = {
  key: string;
  etag: string;
  last_modified: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function accountUrl(accountId: string, key?: string): string {
  const suffix = key ? `/objects/${encodeURIComponent(key)}` : "/objects";
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}${suffix}`;
}

async function api(accountId: string, token: string, key: string | undefined, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept-Encoding")) headers.set("Accept-Encoding", "identity");
  return fetch(accountUrl(accountId, key), { ...init, headers });
}

async function listRamObjects(accountId: string, token: string): Promise<ListedObject[]> {
  const objects: ListedObject[] = [];
  let cursor: string | undefined;
  for (;;) {
    const url = new URL(accountUrl(accountId));
    url.searchParams.set("prefix", PREFIX);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Encoding": "identity",
      },
    });
    if (!response.ok) throw new Error(`list objects failed: ${response.status}`);
    const payload = (await response.json()) as {
      success?: boolean;
      errors?: { message?: string }[];
      result?: ListedObject[];
      result_info?: { is_truncated?: boolean; cursor?: string };
    };
    if (!payload.success || !Array.isArray(payload.result)) {
      const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
      throw new Error(message || "list objects failed");
    }
    objects.push(...payload.result);
    if (!payload.result_info?.is_truncated || !payload.result_info.cursor) break;
    cursor = payload.result_info.cursor;
  }
  return objects.filter((object) => isSuperMarioLandRamKey(object.key));
}

async function openObject(
  accountId: string,
  token: string,
  key: string,
): Promise<{ body: ReadableStream<Uint8Array>; etag: string; uploaded: Date } | null> {
  const response = await api(accountId, token, key);
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw new Error(`get ${key} failed: ${response.status}`);
  return {
    body: response.body,
    etag: response.headers.get("etag") ?? "",
    uploaded: new Date(response.headers.get("last-modified") ?? ""),
  };
}

async function decodeObject(
  accountId: string,
  token: string,
  listed: ListedObject,
): Promise<Contribution | null> {
  const object = await openObject(accountId, token, listed.key);
  if (!object) return null;
  try {
    const frames = await countWorldLevels(object.body, listed.key.endsWith(".gz"));
    const fps = await readRecordingFps(
      {
        async get(key: string) {
          const actions = await openObject(accountId, token, key);
          return actions ? { body: actions.body } : null;
        },
      },
      listed.key,
    );
    const uploadedMs = object.uploaded.getTime();
    const listedMs = Date.parse(listed.last_modified);
    const etag = normalizeEtag(object.etag || listed.etag);
    if (!etag) throw new Error(`missing etag for ${listed.key}`);
    if (Number.isNaN(uploadedMs) && Number.isNaN(listedMs)) {
      throw new Error(`missing upload time for ${listed.key}`);
    }
    return {
      etag,
      uploadedMs: Number.isNaN(uploadedMs) ? listedMs : uploadedMs,
      frames,
      fps,
    };
  } catch (error) {
    if (error instanceof PermanentIngestError) {
      console.log(JSON.stringify({ message: "seed skipped object", key: listed.key, reason: error.message }));
      return null;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requiredEnv("CLOUDFLARE_API_TOKEN");
  if (COVERAGE_KEY.startsWith(PREFIX)) throw new Error("coverage key is inside the upload prefix");
  const listed = await listRamObjects(accountId, token);
  console.log(JSON.stringify({ message: "seed listing", objects: listed.length, key: COVERAGE_KEY }));

  const decoded: { key: string; contribution: Contribution }[] = [];
  let cursor = 0;
  const workers = Array.from({ length: DECODE_CONCURRENCY }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= listed.length) return;
      const item = listed[index];
      if (!item) return;
      const contribution = await decodeObject(accountId, token, item);
      if (!contribution) continue;
      decoded.push({ key: item.key, contribution });
      if (decoded.length % 10 === 0) {
        console.log(JSON.stringify({ message: "seed decoded", done: decoded.length, total: listed.length }));
      }
    }
  });
  await Promise.all(workers);

  decoded.sort((left, right) => left.key.localeCompare(right.key));
  const updatedAt = new Date().toISOString();
  let doc = emptyDocument();
  for (const item of decoded) {
    doc = applyUpload(doc, item.key, item.contribution, updatedAt);
  }

  const body = JSON.stringify(doc);
  const response = await api(accountId, token, COVERAGE_KEY, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`put ${COVERAGE_KEY} failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  const readback = await api(accountId, token, COVERAGE_KEY);
  if (!readback.ok) throw new Error(`readback ${COVERAGE_KEY} failed: ${readback.status}`);
  const confirmed = (await readback.json()) as { version?: number; objects?: Record<string, unknown> };
  const confirmedCount = Object.keys(confirmed.objects ?? {}).length;
  if (confirmed.version !== 1 || confirmedCount !== Object.keys(doc.objects).length) {
    throw new Error("readback did not match the tally");
  }
  console.log(
    JSON.stringify({
      message: "seed wrote",
      key: COVERAGE_KEY,
      objects: Object.keys(doc.objects).length,
      unit: doc.unit,
      levels: doc.levels.map((level) => ({ level: level.level, label: level.label })),
    }),
  );
}

await main();
