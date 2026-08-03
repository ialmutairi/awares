/**
 * POST /api/analyze
 * وصف + إجابات الاستبيان → الأنظمة المنطبقة والمخالفات المحتملة، مع مصادرها.
 *
 * Cloudflare Pages Function.
 */

import { handleAnalyze, respond } from "../../api-core.mjs";

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;

  // نقرأ بيانات المسح الأسبوعي من الأصول الثابتة نفسها لتكون سياقاً للتحليل
  const loadSector = async (id) => {
    const res = await fetch(`${origin}/data/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error("not found");
    return res.json();
  };

  const r = await respond(async () => {
    const body = await request.json().catch(() => ({}));
    return handleAnalyze(body, env, loadSector);
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
}

export function onRequestGet() {
  return new Response(JSON.stringify({ error: "استخدم POST" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
