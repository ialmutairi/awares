/**
 * awares — طبقة المزودين
 *
 * واجهة واحدة فوق ثلاثة نماذج تبحث في الويب مباشرة:
 *   grok    (xAI Responses API + web_search)
 *   gemini  (Google Generative Language + google_search grounding)
 *   claude  (Anthropic Messages + web_search)
 *
 * لا تستورد هذه الوحدة أي شيء من Node — تعمل كما هي في:
 *   - node refresh.mjs
 *   - Cloudflare Pages Functions (Workers runtime)
 *
 * كل مزود يعيد نفس الشكل:  { provider, text, citations: string[] }
 */

/* ============================================================
   أدوات مشتركة
   ============================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch بمهلة زمنية — يمنع تعليق التشغيل على استدعاء بطيء */
async function fetchWithTimeout(url, opts, ms = 180000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * إعادة محاولة مع تباعد تصاعدي.
 * نعيد المحاولة على 429 و5xx والانقطاع الشبكي فقط — أخطاء 4xx الأخرى خطأ في الطلب.
 */
async function withRetry(fn, { tries = 3, base = 3000, label = "" } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e?.fatal || i === tries - 1) break;
      await sleep(base * (i + 1));
    }
  }
  throw new Error(`${label}: ${last?.message || last}`);
}

/** خطأ لا يُعاد معه المحاولة (مفتاح خاطئ، طلب غير صالح…) */
function fatal(msg) {
  const e = new Error(msg);
  e.fatal = true;
  return e;
}

async function readError(res) {
  const body = await res.text().catch(() => "");
  const msg = `HTTP ${res.status} ${body.slice(0, 300)}`;
  // 429 و5xx قابلة لإعادة المحاولة، وما عداها خطأ نهائي
  return res.status === 429 || res.status >= 500 ? new Error(msg) : fatal(msg);
}

/* ============================================================
   المزودون
   ============================================================ */

/* ---------- Grok — xAI ---------- */
const grok = {
  id: "grok",
  label: "Grok",
  envKey: "XAI_API_KEY",
  defaultModel: "grok-4",

  async run(prompt, { key, model = grok.defaultModel, maxTokens = 4000, search = true, timeout } = {}) {
    return withRetry(
      async () => {
        const res = await fetchWithTimeout(
          "https://api.x.ai/v1/responses",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model,
              input: prompt,
              max_output_tokens: maxTokens,
              ...(search ? { tools: [{ type: "web_search" }] } : {}),
            }),
          },
          timeout
        );
        if (!res.ok) throw await readError(res);
        const data = await res.json();
        if (data.error) throw new Error(String(data.error?.message || data.error));

        // output[] يحوي reasoning و web_search_call و message — نأخذ نص الرسالة فقط
        const text = [];
        const citations = [];
        for (const out of data.output || []) {
          if (out.type !== "message") continue;
          for (const c of out.content || []) {
            if (c.text) text.push(c.text);
            for (const a of c.annotations || []) {
              if (a.url) citations.push(a.url);
            }
          }
        }
        return { provider: grok.id, text: text.join("\n"), citations };
      },
      { label: "grok" }
    );
  },
};

/* ---------- Gemini — Google ---------- */
const gemini = {
  id: "gemini",
  label: "Gemini",
  envKey: "GEMINI_API_KEY",
  defaultModel: "gemini-2.5-flash",

  async run(prompt, { key, model = gemini.defaultModel, maxTokens = 4000, search = true, timeout } = {}) {
    return withRetry(
      async () => {
        const res = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              ...(search ? { tools: [{ google_search: {} }] } : {}),
              generationConfig: {
                maxOutputTokens: maxTokens,
                // ميزانية تفكير صغيرة: بدونها قد يستهلك التفكير كل السقف فلا يعود نص
                thinkingConfig: { thinkingBudget: 512 },
              },
            }),
          },
          timeout
        );
        if (!res.ok) throw await readError(res);
        const data = await res.json();
        if (data.error) throw new Error(String(data.error.message || data.error.status));

        const cand = data.candidates?.[0];
        if (!cand) throw new Error("لا مرشّح في الرد");
        const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
        if (!text.trim()) throw new Error(`رد فارغ (finishReason=${cand.finishReason})`);

        // روابط الإسناد تعود كوسيط تحويل، لكن العنوان يحمل النطاق الحقيقي
        const citations = (cand.groundingMetadata?.groundingChunks || [])
          .map((c) => c.web?.title)
          .filter(Boolean)
          .map((host) => (host.startsWith("http") ? host : `https://${host}`));

        return { provider: gemini.id, text, citations };
      },
      { label: "gemini" }
    );
  },
};

/* ---------- Claude — Anthropic ---------- */
const claude = {
  id: "claude",
  label: "Claude",
  envKey: "ANTHROPIC_API_KEY",
  defaultModel: "claude-sonnet-4-5",

  async run(prompt, { key, model = claude.defaultModel, maxTokens = 4000, search = true, timeout } = {}) {
    return withRetry(
      async () => {
        const res = await fetchWithTimeout(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: [{ role: "user", content: prompt }],
              ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}),
            }),
          },
          timeout
        );
        if (!res.ok) throw await readError(res);
        const data = await res.json();

        const text = (data.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("\n");

        const citations = [];
        for (const b of data.content || []) {
          for (const c of b.citations || []) if (c.url) citations.push(c.url);
          if (b.type === "web_search_tool_result") {
            for (const r of b.content || []) if (r.url) citations.push(r.url);
          }
        }
        return { provider: claude.id, text, citations };
      },
      { label: "claude" }
    );
  },
};

export const PROVIDERS = { grok, gemini, claude };

/* ترتيب التفضيل: Grok أولاً (يعيد استشهادات حقيقية)، ثم Gemini، ثم Claude */
export const PREFERRED_ORDER = ["grok", "gemini", "claude"];

/* ============================================================
   الاختيار والتشغيل
   ============================================================ */

/**
 * المزودون المتاحون حسب المفاتيح الموجودة في البيئة.
 * env = process.env في Node، أو كائن البيئة في Workers.
 */
export function availableProviders(env = {}) {
  return PREFERRED_ORDER.map((id) => PROVIDERS[id])
    .filter((p) => !!env[p.envKey])
    .map((p) => ({ ...p, key: env[p.envKey] }));
}

/**
 * ينفّذ على أول مزود ينجح — للحالات التي لا نريد فيها إلا إجابة واحدة.
 * يعيد { provider, text, citations } أو يرمي إن فشل الجميع.
 */
export async function runFirstAvailable(prompt, opts = {}, env = {}) {
  const list = opts.providers || availableProviders(env);
  if (!list.length) throw fatal("لا يوجد أي مفتاح مزود في البيئة");

  const errors = [];
  for (const p of list) {
    try {
      return await p.run(prompt, { ...opts, key: p.key });
    } catch (e) {
      errors.push(`${p.id}: ${e.message}`);
    }
  }
  throw new Error(`فشل كل المزودين — ${errors.join(" | ")}`);
}

/**
 * ينفّذ على كل المزودين بالتوازي ويعيد الناجحين فقط.
 * هذا أساس التحقق المتقاطع: ما يتفق عليه نموذجان أوثق مما ينفرد به واحد.
 */
export async function runAll(prompt, opts = {}, env = {}) {
  const list = opts.providers || availableProviders(env);
  if (!list.length) throw fatal("لا يوجد أي مفتاح مزود في البيئة");

  const settled = await Promise.allSettled(
    list.map((p) => p.run(prompt, { ...opts, key: p.key }))
  );

  const ok = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else failed.push({ provider: list[i].id, error: r.reason?.message || String(r.reason) });
  });

  if (!ok.length) {
    throw new Error(`فشل كل المزودين — ${failed.map((f) => `${f.provider}: ${f.error}`).join(" | ")}`);
  }
  return { results: ok, failed };
}
