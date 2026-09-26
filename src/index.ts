import { coverageStub, GameplayCoverage } from "./coverage";
import { renderGameplayPage } from "./page";

export { GameplayCoverage };

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

const CREATE_ACTIONS = new Set(["PutObject", "CopyObject", "CompleteMultipartUpload"]);

export type CoverageMessage = {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(): void;
};

type CreateNotice = {
  key: string;
  etag: string;
};

function readCreateNotice(body: unknown): CreateNotice | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { action?: unknown; object?: unknown };
  if (typeof record.action !== "string" || !CREATE_ACTIONS.has(record.action)) return null;
  if (!record.object || typeof record.object !== "object") return null;
  const object = record.object as { key?: unknown; eTag?: unknown };
  if (typeof object.key !== "string" || object.key.length === 0) return null;
  if (typeof object.eTag !== "string" || object.eTag.length === 0) return null;
  return { key: object.key, etag: object.eTag };
}

export async function consumeCoverageMessage(
  env: Env,
  message: CoverageMessage,
): Promise<void> {
  const notice = readCreateNotice(message.body);
  if (!notice) {
    message.ack();
    return;
  }
  try {
    const result = await coverageStub(env).ingest(notice.key, notice.etag);
    if (result.status === "updated") {
      console.log(JSON.stringify({ message: "coverage updated", key: notice.key }));
    } else if (result.status === "permanent") {
      console.error(
        JSON.stringify({
          message: "coverage object skipped",
          key: notice.key,
          reason: result.reason,
        }),
      );
    }
    message.ack();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "coverage ingest failed",
        key: notice.key,
        attempts: message.attempts,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    if (message.attempts >= 3) message.ack();
    else message.retry();
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: SECURITY_HEADERS });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: SECURITY_HEADERS,
      });
    }
    try {
      if (url.pathname === "/api/gameplay" || url.pathname === "/api/gameplay/") {
        const chart = await coverageStub(env).chart();
        return json(chart);
      }
      if (url.pathname === "/gameplay" || url.pathname === "/gameplay/") {
        const chart = await coverageStub(env).chart();
        const headers = {
          ...SECURITY_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
        };
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });
        return new Response(renderGameplayPage(chart), { status: 200, headers });
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return new Response("Internal error", { status: 500, headers: SECURITY_HEADERS });
    }
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      await consumeCoverageMessage(env, message);
    }
  },

  async scheduled(_controller, env): Promise<void> {
    const result = await coverageStub(env).backfill();
    if (result.updated > 0) {
      console.log(
        JSON.stringify({
          message: "coverage backfill",
          updated: result.updated,
          done: result.done,
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
