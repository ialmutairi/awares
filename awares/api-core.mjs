/**
 * awares — منطق واجهة التحليل الفوري
 *
 * يستخدمه اثنان بلا تكرار:
 *   functions/api/*.js   → Cloudflare Pages Functions (الإنتاج)
 *   dev-api.mjs          → وسيط Vite أثناء التطوير المحلي
 *
 * المفاتيح لا تصل المتصفح أبداً — كل استدعاء يمرّ من هنا على الخادم.
 */

import { SECTORS } from "./sectors.mjs";
import { runFirstAvailable, availableProviders } from "./providers.mjs";
import { withCache, TTL } from "./cache.mjs";
import { validateSource, sectorHint, SourceRejected } from "./sources.mjs";
import {
  putSource, listSources, sourceExists,
  putFeedback, feedbackSummary, recentNotes, storeKind,
} from "./store.mjs";
import {
  intakePrompt,
  analyzePrompt,
  formatAnswers,
  extractJSON,
  sanitizeIntake,
  sanitizeAnalysis,
} from "./analysis.mjs";

/* حدود المدخلات — سقف التكلفة وسطح إساءة الاستخدام */
const MAX_DESC = 1200;
const MAX_ANSWERS = 12;
const MAX_ANSWER_LEN = 300;

const SECTOR_LIST = SECTORS.map((s) => ({ id: s.id, name: s.name }));

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireDescription(body) {
  const description = String(body?.description || "").trim().slice(0, MAX_DESC);
  if (description.length < 15) {
    throw new ApiError(400, "اكتب وصفاً أوضح لمنشأتك — جملتان على الأقل.");
  }
  return description;
}

/* ============================================================
   ١) الاستبيان الديناميكي
   ============================================================ */

/**
 * يحوّل وصفاً حرّاً إلى أسئلة مفصّلة على هذا النشاط بالذات.
 * لا نستخدم البحث هنا: المطلوب صياغة أسئلة لا استقصاء مصادر — أسرع وأرخص.
 */
export async function handleIntake(body, env) {
  const description = requireDescription(body);

  const { value, cached } = await withCache("intake", [description], TTL.intake, async () => {
    const { text, provider } = await runFirstAvailable(
      intakePrompt(description, SECTOR_LIST),
      { maxTokens: 2500, search: false },
      env
    );

    const parsed = sanitizeIntake(extractJSON(text), new Set(SECTORS.map((s) => s.id)));
    if (!parsed.questions.length) {
      throw new ApiError(502, "تعذّر توليد الاستبيان. أعد المحاولة.");
    }
    return { ...parsed, provider };
  });

  return { ...value, cached };
}

/* ============================================================
   ٢) التحليل الكامل
   ============================================================ */

/**
 * يجمع بنود القطاعات المرصودة أسبوعياً كسياق مُثبت للنموذج.
 * الفائدة: النموذج يبحث للتحقق والإضافة بدل إعادة اكتشاف ما رصدناه أصلاً.
 */
async function buildContext(sectorIds, loadSector) {
  if (!sectorIds?.length || !loadSector) return "";

  const blocks = [];
  for (const id of sectorIds.slice(0, 3)) {
    const data = await loadSector(id).catch(() => null);
    if (!data?.agencies) continue;

    const lines = [];
    for (const agency of data.agencies) {
      for (const item of agency.items || []) {
        lines.push(`  • [${agency.name}] ${item.name} — ${item.status} — ${item.penalty}`);
      }
    }
    if (lines.length) blocks.push(`${data.name}:\n${lines.slice(0, 20).join("\n")}`);
  }
  return blocks.join("\n\n");
}

function cleanAnswers(questions, answers) {
  const valid = new Set((questions || []).map((q) => q.id));
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(answers || {})) {
    if (!valid.has(k) || n >= MAX_ANSWERS) continue;
    const val = Array.isArray(v)
      ? v.slice(0, 8).map((x) => String(x).slice(0, MAX_ANSWER_LEN))
      : String(v ?? "").slice(0, MAX_ANSWER_LEN);
    if (Array.isArray(val) ? val.length : val.trim()) {
      out[k] = val;
      n++;
    }
  }
  return out;
}

export async function handleAnalyze(body, env, loadSector) {
  const description = requireDescription(body);

  const questions = Array.isArray(body?.questions) ? body.questions.slice(0, 8) : [];
  const answers = cleanAnswers(questions, body?.answers);
  const business = body?.business || {};
  const sectorIds = (Array.isArray(business.sectorIds) ? business.sectorIds : []).filter((id) =>
    SECTORS.some((s) => s.id === id)
  );

  const answersText = formatAnswers(questions, answers);

  // المفتاح من الوصف والإجابات معاً — تغيير أي إجابة يعني تحليلاً مختلفاً
  const { value, cached } = await withCache(
    "analyze",
    [description, answersText, sectorIds.join(",")],
    TTL.analyze,
    async () => {
      const context = await buildContext(sectorIds, loadSector);

      const { text, citations, provider } = await runFirstAvailable(
        analyzePrompt({ description, business, answersText, context }),
        { maxTokens: 7000, search: true },
        env
      );

      const result = sanitizeAnalysis(extractJSON(text), { citations });
      if (!result.items.length) {
        throw new ApiError(502, "لم يُرجع التحليل بنوداً صالحة. أعد المحاولة أو وسّع الوصف.");
      }

      return {
        ...result,
        business: { label: business.label || "منشأة", sectorIds },
        provider,
        generatedAt: new Date().toISOString(),
      };
    }
  );

  return { ...value, cached };
}

/* ============================================================
   ٣) المصادر المقترحة من المستخدمين
   ============================================================ */

/** معرّف قصير بلا اعتماد على Math.random — يعمل في Workers */
function newId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function handleSubmitSource(body, env) {
  const sectorId = String(body?.sectorId || "").trim();
  if (!SECTORS.some((s) => s.id === sectorId)) {
    throw new ApiError(400, "اختر قطاعاً صحيحاً.");
  }

  let checked;
  try {
    checked = await validateSource(body?.url);
  } catch (e) {
    // رسائل الرفض مكتوبة للمستخدم، فنمرّرها كما هي
    if (e instanceof SourceRejected) throw new ApiError(400, e.message);
    throw e;
  }

  if (await sourceExists(env, sectorId, checked.host)) {
    throw new ApiError(409, `لدينا مصدر من «${checked.host}» لهذا القطاع بالفعل.`);
  }

  const rec = {
    id: newId(),
    sectorId,
    url: checked.url,
    host: checked.host,
    regulator: checked.regulator,
    note: String(body?.note || "").trim().slice(0, 300),
    at: new Date().toISOString(),
    // لا يُرقّى للسجل إلا بمراجعة بشرية — لا نعرضه كمرجع موثوق
    status: "pending",
  };
  await putSource(env, rec);

  return { ok: true, source: rec, hint: sectorHint(sectorId, checked.host) };
}

export async function handleListSources(env, sectorId) {
  const rows = await listSources(env, sectorId);
  return {
    sources: rows.map(({ id, sectorId: s, url, host, regulator, note, at, status }) => ({
      id, sectorId: s, url, host, regulator, note, at, status,
    })),
  };
}

/* ============================================================
   ٤) التقييم بعد التجربة
   ============================================================ */

export async function handleFeedback(body, env) {
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ApiError(400, "التقييم من ١ إلى ٥.");
  }
  const rec = {
    id: newId(),
    rating,
    helpful: !!body?.helpful,
    note: String(body?.note || "").trim().slice(0, 500),
    sector: String(body?.sector || "").slice(0, 60),
    at: new Date().toISOString(),
  };
  await putFeedback(env, rec);
  return { ok: true, summary: await feedbackSummary(env), notes: await recentNotes(env) };
}

/** ملخّص عام يُعرض في لوحة الجودة */
export async function handleStats(env) {
  return {
    feedback: await feedbackSummary(env),
    notes: await recentNotes(env),
    store: storeKind(env),
  };
}

/* ============================================================
   ٥) المُوجّه المشترك
   ============================================================ */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

/**
 * يوحّد معالجة الطلب بين Workers و Vite: يتحقق من الطريقة، ويلتقط الأخطاء،
 * ويعيد رسالة عربية مفهومة بدل تتبّع المكدّس.
 */
export async function respond(handler) {
  try {
    const data = await handler();
    return { status: 200, body: JSON.stringify(data), headers: JSON_HEADERS };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    const message =
      e instanceof ApiError
        ? e.message
        : String(e?.message || e).includes("لا يوجد أي مفتاح")
        ? "خدمة التحليل غير مُهيّأة على الخادم — ينقص مفتاح المزود."
        : "تعذّر إكمال التحليل. أعد المحاولة بعد قليل.";
    return {
      status,
      body: JSON.stringify({ error: message, detail: String(e?.message || e).slice(0, 300) }),
      headers: JSON_HEADERS,
    };
  }
}

export function providersConfigured(env) {
  return availableProviders(env).map((p) => p.id);
}
