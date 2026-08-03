/**
 * GET  /api/feedback → ملخّص التقييمات (يُعرض للعموم)
 * POST /api/feedback → تقييم بعد التجربة
 */

import { handleFeedback, handleStats, respond } from "../../api-core.mjs";

export async function onRequestGet({ env }) {
  const r = await respond(() => handleStats(env));
  return new Response(r.body, { status: r.status, headers: r.headers });
}

export async function onRequestPost({ request, env }) {
  const r = await respond(async () => {
    const body = await request.json().catch(() => ({}));
    return handleFeedback(body, env);
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
