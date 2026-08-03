/**
 * awares — اختيار الواجهة الخلفية
 *
 * المشروع يعمل بتركيبتين:
 *
 * أ) Cloudflare Pages (الافتراضي)
 *    كل شيء في مكان واحد: /api/* دوال، والتخزين KV. لا إعداد.
 *
 * ب) GitHub Pages + Firebase
 *    GitHub Pages استضافة ثابتة لا تشغّل خادماً، فنقسم المسؤوليات:
 *      - المصادر والتقييمات → Firestore مباشرة من المتصفح (مجاني على Spark)
 *      - التحليل بالذكاء الاصطناعي → Cloudflare Worker منفصل عبر VITE_API_BASE
 *
 *    لماذا لا يذهب التحليل لـ Firestore أيضاً؟ لأنه يحتاج مفاتيح Grok/Gemini،
 *    ومفتاح في المتصفح = مفتاح مسروق. لا بد من خادم يحملها. ودوال Firebase
 *    تتطلب خطة Blaze ببطاقة، بينما Worker مجاني بلا بطاقة.
 *
 * المتغيّرات (وقت البناء):
 *   VITE_API_BASE          عنوان الـ Worker، مثل https://awares-api.you.workers.dev
 *   VITE_FIREBASE_PROJECT  معرّف مشروع Firebase
 *   VITE_FIREBASE_KEY      مفتاح الويب (عام بطبيعته — الحماية بقواعد الأمان لا بإخفائه)
 */

const API_BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/$/, "");
const FB_PROJECT = import.meta.env?.VITE_FIREBASE_PROJECT || "";
const FB_KEY = import.meta.env?.VITE_FIREBASE_KEY || "";

export const useFirestore = !!(FB_PROJECT && FB_KEY);

const FS = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

/* ============================================================
   نداءات عامة
   ============================================================ */

export const apiUrl = (path) => `${API_BASE}${path}`;

export async function postJSON(path, body) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "تعذّر الاتصال بالخادم.");
  return data;
}

export async function getJSON(path) {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error("تعذّر الجلب");
  return res.json();
}

/* ============================================================
   Firestore عبر REST — بلا حزمة SDK، فلا يكبر الحزمة
   ============================================================ */

/** Firestore يغلّف كل قيمة بنوعها؛ هذه تحوّل كائناً عادياً لصيغته */
const toFields = (obj) => {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") fields[k] = { integerValue: String(Math.trunc(v)) };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  return { fields };
};

/** والعكس */
const fromFields = (doc) => {
  const out = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) {
    if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else out[k] = v.stringValue ?? "";
  }
  out.id = String(doc?.name || "").split("/").pop();
  return out;
};

async function fsAdd(collection, obj) {
  const res = await fetch(`${FS}/${collection}?key=${FB_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(toFields(obj)),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || "تعذّر الحفظ في قاعدة البيانات.");
  }
  return fromFields(await res.json());
}

async function fsList(collection) {
  const res = await fetch(`${FS}/${collection}?key=${FB_KEY}&pageSize=300`);
  if (!res.ok) return [];
  const j = await res.json();
  return (j.documents || []).map(fromFields);
}

/* ============================================================
   المصادر
   ============================================================ */

export async function listSources(sectorId) {
  if (!useFirestore) {
    return (await getJSON(`/api/sources?sector=${encodeURIComponent(sectorId)}`)).sources || [];
  }
  return (await fsList("sources")).filter((s) => s.sectorId === sectorId);
}

export async function submitSource({ sectorId, url, validate }) {
  if (!useFirestore) return postJSON("/api/sources", { sectorId, url });

  // بلا خادم لا يمكن التحقق أن الرابط يفتح — CORS يمنع قراءة رد gov.sa.
  // نطبّق ما يمكن تطبيقه في المتصفح: الشكل والنطاق الرسمي وعدم التكرار.
  const checked = validate(url);
  const existing = await listSources(sectorId);
  if (existing.some((s) => s.host === checked.host)) {
    throw new Error(`لدينا مصدر من «${checked.host}» لهذا القطاع بالفعل.`);
  }
  const rec = await fsAdd("sources", {
    sectorId,
    url: checked.url,
    host: checked.host,
    regulator: checked.regulator || "",
    at: new Date().toISOString(),
    status: "pending",
    // نوثّق أن هذا المسار لم يفحص حياة الرابط — لا نخفيه
    linkChecked: false,
  });
  return { ok: true, source: rec, hint: null };
}

/* ============================================================
   التقييمات
   ============================================================ */

function summarize(rows) {
  if (!rows.length) return { count: 0, average: null, helpful: null };
  const sum = rows.reduce((s, r) => s + Number(r.rating || 0), 0);
  return {
    count: rows.length,
    average: Math.round((sum / rows.length) * 10) / 10,
    helpful: Math.round((rows.filter((r) => r.helpful).length / rows.length) * 100),
  };
}

export async function feedbackSummary() {
  if (!useFirestore) {
    return (await getJSON("/api/feedback")).feedback;
  }
  return summarize(await fsList("feedback"));
}

export async function sendFeedback(rec) {
  if (!useFirestore) return postJSON("/api/feedback", rec);
  await fsAdd("feedback", { ...rec, at: new Date().toISOString() });
  return { ok: true, summary: summarize(await fsList("feedback")) };
}
