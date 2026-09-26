import { DurableObject } from "cloudflare:workers";
import {
  applyContribution,
  emptyChart,
  shouldReplace,
  toPublic,
  type ChartState,
  type Contribution,
  type PublicChart,
} from "./chart";
import {
  countWorldLevels,
  isSuperMarioLandRamKey,
  normalizeEtag,
  PermanentIngestError,
  readRecordingFps,
} from "./ram";

const OBJECT_PREFIX = "obj:";
const CHART_KEY = "chart";
const PAGE_CURSOR_KEY = "backfillPageCursor";
const RESUME_AFTER_KEY = "backfillResumeAfter";
const LIST_PREFIX = "raw/skyemu/";
const LIST_PAGE_SIZE = 100;
const MAX_DOWNLOADS = 4;

export type IngestResult =
  | { status: "ignored" | "skipped" | "updated" }
  | { status: "permanent"; reason: string };

export function coverageStub(env: Env): DurableObjectStub<GameplayCoverage> {
  const id = env.GAMEPLAY_COVERAGE.idFromName("super-mario-land");
  return env.GAMEPLAY_COVERAGE.get(id);
}

function objectStorageKey(key: string): string {
  return `${OBJECT_PREFIX}${key}`;
}

export class GameplayCoverage extends DurableObject<Env> {
  async chart(): Promise<PublicChart> {
    const state = await this.ctx.storage.get<ChartState>(CHART_KEY);
    return toPublic(state ?? emptyChart());
  }

  async ingest(key: string, etagHint: string): Promise<IngestResult> {
    if (!isSuperMarioLandRamKey(key)) return { status: "ignored" };
    const hinted = normalizeEtag(etagHint);
    const storageKey = objectStorageKey(key);
    const existing = (await this.ctx.storage.get<Contribution>(storageKey)) ?? null;
    if (existing && hinted && existing.etag === hinted) return { status: "skipped" };

    const head = await this.env.DATASETS.head(key);
    if (!head) {
      if (!existing) return { status: "skipped" };
      await this.commit(storageKey, null);
      return { status: "updated" };
    }

    const headed = normalizeEtag(head.etag);
    if (existing?.etag === headed) return { status: "skipped" };
    if (existing && existing.uploadedMs > head.uploaded.getTime()) return { status: "skipped" };

    const object = await this.env.DATASETS.get(key);
    if (!object) {
      if (!existing) return { status: "skipped" };
      await this.commit(storageKey, null);
      return { status: "updated" };
    }

    let contribution: Contribution;
    try {
      const frames = await countWorldLevels(object.body, key.endsWith(".gz"));
      const fps = await readRecordingFps(this.env.DATASETS, key);
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

    if (!shouldReplace(existing, contribution)) return { status: "skipped" };
    const wrote = await this.commit(storageKey, contribution);
    return { status: wrote ? "updated" : "skipped" };
  }

  async backfill(): Promise<{ updated: number; done: boolean }> {
    const storedCursor = await this.ctx.storage.get<string>(PAGE_CURSOR_KEY);
    const pageCursor = storedCursor ? storedCursor : undefined;
    const resumeAfter = (await this.ctx.storage.get<string>(RESUME_AFTER_KEY)) ?? "";
    const listed = await this.env.DATASETS.list({
      prefix: LIST_PREFIX,
      cursor: pageCursor,
      limit: LIST_PAGE_SIZE,
    });

    let updated = 0;
    for (const object of listed.objects) {
      if (object.key <= resumeAfter) continue;
      if (!isSuperMarioLandRamKey(object.key)) continue;
      const result = await this.ingest(object.key, object.etag);
      if (result.status === "updated") updated += 1;
      if (result.status === "permanent") {
        console.error(
          JSON.stringify({
            message: "coverage object skipped",
            key: object.key,
            reason: result.reason,
          }),
        );
      }
      if (updated >= MAX_DOWNLOADS) {
        await this.ctx.storage.put(PAGE_CURSOR_KEY, pageCursor ?? "");
        await this.ctx.storage.put(RESUME_AFTER_KEY, object.key);
        return { updated, done: false };
      }
    }

    if (listed.truncated && listed.cursor) {
      await this.ctx.storage.put(PAGE_CURSOR_KEY, listed.cursor);
      await this.ctx.storage.delete(RESUME_AFTER_KEY);
      return { updated, done: false };
    }

    await this.ctx.storage.delete(PAGE_CURSOR_KEY);
    await this.ctx.storage.delete(RESUME_AFTER_KEY);
    return { updated, done: true };
  }

  private async commit(storageKey: string, next: Contribution | null): Promise<boolean> {
    return this.ctx.storage.transaction(async (txn) => {
      const again = (await txn.get<Contribution>(storageKey)) ?? null;
      if (next && !shouldReplace(again, next)) return false;
      if (!next && !again) return false;
      const chart = (await txn.get<ChartState>(CHART_KEY)) ?? emptyChart();
      const updated = applyContribution(chart, again, next, new Date().toISOString());
      if (next) await txn.put(storageKey, next);
      else await txn.delete(storageKey);
      await txn.put(CHART_KEY, updated);
      return true;
    });
  }
}
