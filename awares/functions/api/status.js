/**
 * GET /api/status
 * تخبر الواجهة هل التحليل الفوري مُهيّأ — فتُظهر النموذج أو تُخفيه
 * بدل أن يكتب الزائر وصفه ثم يصطدم بخطأ.
 */

import { providersConfigured } from "../../api-core.mjs";

export function onRequestGet({ env }) {
  const providers = providersConfigured(env);
  return new Response(JSON.stringify({ ready: providers.length > 0, providers }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
