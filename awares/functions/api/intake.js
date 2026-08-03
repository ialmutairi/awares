/**
 * POST /api/intake
 * وصف حر للمنشأة → استبيان مفصّل على نشاطها.
 *
 * Cloudflare Pages Function. المفاتيح تُقرأ من متغيرات البيئة في لوحة Pages:
 * XAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY
 */

import { handleIntake, respond } from "../../api-core.mjs";

export async function onRequestPost({ request, env }) {
  const r = await respond(async () => {
    const body = await request.json().catch(() => ({}));
    return handleIntake(body, env);
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
}

export function onRequestGet() {
  return new Response(JSON.stringify({ error: "استخدم POST" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
