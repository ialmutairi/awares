/**
 * GET  /api/sources?sector=food   → المصادر المقترحة لهذا القطاع
 * POST /api/sources               → اقتراح مصدر جديد (يمرّ بسلسلة فحص)
 *
 * يحتاج ربط KV باسم AWARES_KV في لوحة Cloudflare Pages.
 * بدونه يعمل على ذاكرة العملية وتضيع المقترحات عند إعادة النشر.
 */

import { handleSubmitSource, handleListSources, respond } from "../../api-core.mjs";

export async function onRequestGet({ request, env }) {
  const sector = new URL(request.url).searchParams.get("sector") || "";
  const r = await respond(() => handleListSources(env, sector));
  return new Response(r.body, { status: r.status, headers: r.headers });
}

export async function onRequestPost({ request, env }) {
  const r = await respond(async () => {
    const body = await request.json().catch(() => ({}));
    return handleSubmitSource(body, env);
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
