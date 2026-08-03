/**
 * awares — خادم /api على Cloudflare Workers
 *
 * لماذا Worker منفصل: GitHub Pages استضافة ثابتة لا تشغّل خادماً، ومفاتيح
 * Grok/Gemini لا يجوز نزولها للمتصفح. هذا الملف هو الخادم الوحيد، ويحمل
 * المفاتيح كأسرار، وقاعدة البيانات KV مربوطة به.
 *
 * إن نشرت على Cloudflare Pages بدل GitHub Pages فلا تحتاج هذا الملف —
 * مجلد functions/ يقوم بنفس الدور على نفس النطاق بلا CORS.
 *
 * النشر:  npm run deploy:api
 */

import {
  handleIntake, handleAnalyze, handleSubmitSource, handleListSources,
  handleFeedback, handleStats, respond, providersConfigured,
} from "../api-core.mjs";

/**
 * الأصول المسموح لها بالنداء.
 * ALLOWED_ORIGINS متغيّر بيئة، قائمة مفصولة بفاصلة. مثال:
 *   https://ialmutairi.github.io,http://localhost:5173
 * نتركه فارغاً = نسمح للجميع (مناسب للتجربة، ضيّقه قبل الإطلاق).
 */
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ok = !allowed.length || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin || "*" : allowed[0] || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const json = (data, status, extra) =>
  new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (path === "/" || path === "/api") {
      return json(
        { name: "awares-api", providers: providersConfigured(env), kv: !!env.AWARES_KV },
        200,
        cors
      );
    }

    // قراءة بيانات القطاع من الموقع الثابت لتكون سياقاً للتحليل (اختياري)
    const loadSector = env.SITE_ORIGIN
      ? async (id) => {
          const res = await fetch(`${env.SITE_ORIGIN}/data/${encodeURIComponent(id)}.json`);
          if (!res.ok) throw new Error("not found");
          return res.json();
        }
      : null;

    const body = async () => (await request.json().catch(() => ({})));

    let out;
    if (request.method === "GET") {
      if (path === "/api/status") {
        const providers = providersConfigured(env);
        return json({ ready: providers.length > 0, providers }, 200, cors);
      }
      if (path === "/api/sources")
        out = await respond(() => handleListSources(env, url.searchParams.get("sector") || ""));
      else if (path === "/api/feedback") out = await respond(() => handleStats(env));
    } else if (request.method === "POST") {
      if (path === "/api/intake") out = await respond(async () => handleIntake(await body(), env));
      else if (path === "/api/analyze")
        out = await respond(async () => handleAnalyze(await body(), env, loadSector));
      else if (path === "/api/sources")
        out = await respond(async () => handleSubmitSource(await body(), env));
      else if (path === "/api/feedback")
        out = await respond(async () => handleFeedback(await body(), env));
    }

    if (!out) return json({ error: "مسار غير معروف" }, 404, cors);
    return new Response(out.body, { status: out.status, headers: { ...out.headers, ...cors } });
  },
};
