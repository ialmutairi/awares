/**
 * awares — محرك التحليل
 *
 * كل ما يخص: صياغة الأسئلة للنموذج، واستخراج JSON من ردّه، والتحقق من المخرجات
 * قبل عرضها. يستخدمه كلٌّ من refresh.mjs (التوليد الأسبوعي) ودوال /api (التحليل الفوري).
 *
 * لا يستورد شيئاً من Node — يعمل في Node وفي Cloudflare Workers.
 */

import { OFFICIAL_HOSTS } from "./regulators.mjs";

/* ============================================================
   ١) التحقق من المصادر
   ============================================================ */

/**
 * النطاقات الرسمية غير المنتهية بـ gov.sa تأتي من السجل المُتحقَّق منه حياً
 * في regulators.mjs (مثل cma.gov.sa و socpa.org.sa و sca.sa).
 * لا نكتب قائمة يدوية هنا — القائمة اليدوية السابقة كانت تحوي cchi.gov.sa
 * وهو نطاق ميت لا سجل DNS له، والصحيح chi.gov.sa.
 */

/**
 * يقبل الرابط فقط إن كان مضيفه رسمياً.
 * نتحقق من المضيف عبر URL لا بتعبير نمطي على النص الكامل — لأن
 * `https://example.com/fake.gov.sa/` كان يمرّ من الفحص القديم.
 */
export function officialSource(url) {
  if (!url || typeof url !== "string") return null;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const ok = host === "gov.sa" || host.endsWith(".gov.sa") || OFFICIAL_HOSTS.has(host);
  return ok ? u.toString() : null;
}

/** المضيف المجرّد — للمقارنة بين ما ادّعاه النموذج وما بحث فيه فعلاً */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ============================================================
   ٢) استخراج JSON من رد النموذج
   ============================================================ */

/**
 * النماذج تسبق JSON بمقدمة أو تغلّفه بـ ```json رغم التعليمات.
 * نقشّر الأسوار ثم نأخذ أول كتلة متوازنة الأقواس — أدق من indexOf/lastIndexOf
 * الذي يبتلع أي نص بعد الكائن.
 */
export function extractJSON(text) {
  if (!text) throw new Error("رد فارغ");
  const clean = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();

  const start = clean.indexOf("{");
  if (start === -1) throw new Error("لا يوجد JSON في الرد");

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(clean.slice(start, i + 1));
    }
  }
  // لم تُغلق الأقواس (اقتُطع الرد) — نحاول آخر قوس كمحاولة أخيرة
  const end = clean.lastIndexOf("}");
  if (end > start) return JSON.parse(clean.slice(start, end + 1));
  throw new Error("JSON غير مكتمل في الرد");
}

/* ============================================================
   ٣) تنظيف بنود الالتزام
   ============================================================ */

const STATUSES = ["draft", "issued", "grace", "enforced"];
const SEVERITIES = ["high", "medium", "low"];

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/**
 * لا يُنشر بند لم يمر من هنا.
 * `citations` = الروابط التي زارها النموذج فعلاً؛ نستخدمها لوسم البنود
 * التي ادّعت مصدراً لم يظهر في بحثها.
 */
export function sanitizeItems(items, { citations = [], max = 3, extra = null } = {}) {
  if (!Array.isArray(items)) return [];
  const searched = new Set(citations.map(hostOf).filter(Boolean));

  return items
    .filter((it) => it && typeof it.name === "string" && it.name.trim().length > 4)
    .map((it) => {
      const source = officialSource(it.source);
      return {
        // الحقول الإضافية تُقرأ من نفس العنصر داخل map — لا بالفهرس بعد الفلترة
        ...(extra ? extra(it) : null),
        name: str(it.name, 200),
        status: STATUSES.includes(it.status) ? it.status : "enforced",
        statusNote: str(it.statusNote, 200),
        summary: str(it.summary, 400),
        violation: str(it.violation, 300),
        penalty: str(it.penalty, 220) || "غير محدد في المصدر",
        severity: SEVERITIES.includes(it.severity) ? it.severity : "medium",
        steps: Array.isArray(it.steps) ? it.steps.slice(0, 4).map((s) => str(s, 200)).filter(Boolean) : [],
        source,
        // وسم شفافية: مصدر رسمي لكنه لم يظهر ضمن نتائج البحث الفعلية
        unverifiedSource: !!source && searched.size > 0 && !searched.has(hostOf(source)),
      };
    })
    .slice(0, max);
}

/* ============================================================
   ٤) التحقق المتقاطع بين المزودين
   ============================================================ */

/** تطبيع الاسم للمقارنة: حذف التشكيل والألف/الياء/التاء المربوطة وعلامات الترقيم */
function normalizeName(s) {
  return String(s || "")
    // بالرموز الصريحة: كتابتها [\u064B-\u0670] تبتلع \u0660..\u0669
    // وهي الأرقام الهندية — فتضيع أرقام المواد وسنوات الأنظمة من المقارنة
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** تشابه بمعامل Dice على الكلمات — يكفي لكشف «نفس النظام بصياغتين» */
function similar(a, b) {
  const A = new Set(normalizeName(a).split(" ").filter((w) => w.length > 2));
  const B = new Set(normalizeName(b).split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/**
 * يدمج مخرجات عدة مزودين لنفس الجهة.
 *
 * الفائدة الحقيقية: البند الذي يذكره نموذجان مستقلان أوثق بكثير من بند
 * انفرد به نموذج واحد — وهذا أرخص طريقة لكشف الغرامات المخترعة.
 *
 * confidence: "confirmed" (مزودان فأكثر) | "single" (مزود واحد)
 */
export function crossVerify(perProvider, { max = 4 } = {}) {
  const merged = [];

  for (const { provider, items } of perProvider) {
    for (const item of items) {
      const twin = merged.find((m) => similar(m.name, item.name) >= 0.5);
      if (!twin) {
        merged.push({ ...item, sources: [provider] });
        continue;
      }
      if (!twin.sources.includes(provider)) twin.sources.push(provider);

      // نرجّح المعلومة الأغنى: مصدر رسمي موجود، ونص أطول، وخطورة أعلى
      if (!twin.source && item.source) {
        twin.source = item.source;
        twin.unverifiedSource = item.unverifiedSource;
      }
      if (item.penalty && item.penalty !== "غير محدد في المصدر" && twin.penalty === "غير محدد في المصدر") {
        twin.penalty = item.penalty;
      }
      if ((item.summary?.length || 0) > (twin.summary?.length || 0)) twin.summary = item.summary;
      if (!twin.steps?.length && item.steps?.length) twin.steps = item.steps;
      if (SEVERITIES.indexOf(item.severity) < SEVERITIES.indexOf(twin.severity)) twin.severity = item.severity;
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return merged
    .map((m) => ({
      ...m,
      confidence: m.sources.length > 1 ? "confirmed" : "single",
      verifiedBy: m.sources,
    }))
    .sort((a, b) => {
      // المؤكّد أولاً، ثم الأعلى خطورة
      if (a.confidence !== b.confidence) return a.confidence === "confirmed" ? -1 : 1;
      return rank[a.severity] - rank[b.severity];
    })
    .slice(0, max);
}

/* ============================================================
   ٥) الصياغات (prompts)
   ============================================================ */

const RULES = `قواعد صارمة لا تُخالف:
- لا تخترع رقم غرامة إطلاقاً. إن لم تجد الرقم في مصدر رسمي فاكتب: "غير محدد في المصدر".
- المصدر يجب أن يكون رابطاً حقيقياً ظهر في بحثك، ونطاقه ينتهي بـ gov.sa (أو نطاق الهيئة الرسمي).
- لا تعتمد على المدونات ومكاتب المحاماة كمصدر — استخدمها للوصول للمصدر الرسمي فقط.
- اكتب بالعربية، ومختصراً.
- أعد JSON فقط. بلا markdown وبلا أي نص قبله أو بعده.`;

const STATUS_GUIDE = `حدّد الحالة بدقة:
- draft = مشروع تحت الاستطلاع العام (istitlaa.ncc.gov.sa) ولم يُقر
- issued = صدر رسمياً لكن تاريخ النفاذ لم يحن
- grace = نافذ لكن في فترة سماح أو تطبيق تدريجي
- enforced = نافذ ومطبّق بالكامل`;

/** مسح جهة واحدة لقطاع — يُستخدم في التوليد الأسبوعي */
export function agencyPrompt(agency, sector) {
  return `أنت محلل رصد تنظيمي متخصص في أنظمة المملكة العربية السعودية.

المنشأة المستهدفة: ${sector.profile}
الجهة موضع البحث: ${agency}

ابحث في المصادر الرسمية عن أهم الالتزامات التنظيمية الحالية لهذه الجهة على هذا النوع من المنشآت.

ابحث تحديداً عن:
1. "جدول تصنيف المخالفات وتحديد العقوبات" الخاص بأنظمة هذه الجهة — أهم مستند وفيه الغرامات صريحة
2. أي مشروع نظام أو لائحة لهذه الجهة منشور حالياً على منصة استطلاع (istitlaa.ncc.gov.sa)

${STATUS_GUIDE}

قم بـ ٣ عمليات بحث على الأقل، واجعل إحداها مخصّصة للعقوبات: "<اسم النظام> جدول تصنيف المخالفات والعقوبات".
اذكر الغرامة بالريال كما وردت حرفياً (رقماً أو مدى)، ولا تكتب "غير محدد في المصدر" إلا بعد بحث فعلي عن الجدول.

أعِد ٣ التزامات كحد أقصى — الأكثر أهمية وإلحاحاً.

الشكل المطلوب:
{"items":[{"name":"اسم النظام أو اللائحة","status":"draft|issued|grace|enforced","statusNote":"التاريخ أو المهلة","summary":"جملة واحدة: بماذا يُلزم","violation":"المخالفة عند عدم الالتزام","penalty":"الغرامة كما وردت حرفياً، أو: غير محدد في المصدر","severity":"high|medium|low","steps":["خطوة","خطوة"],"source":"رابط رسمي"}]}

${RULES}`;
}

/* ---------- الاستبيان الديناميكي ---------- */

/**
 * المرحلة ١: من وصف حر للمنشأة، يولّد النموذج أسئلة مفصّلة على هذا النشاط تحديداً.
 *
 * السبب: «مقهى» وحدها لا تكفي. الفرق بين مقهى بفرع واحد ومقهى يحمّص ويبيع أونلاين
 * ويشغّل مطبخاً هو الفرق بين ٤ جهات رقابية و٩. الأسئلة هي ما يحوّل الوصف إلى ملف دقيق.
 */
export function intakePrompt(description, sectorList) {
  return `أنت مستشار امتثال سعودي. وصلك هذا الوصف من صاحب منشأة:

"""${String(description).slice(0, 1200)}"""

مهمتك: صمّم استبياناً قصيراً يكشف ما ينقصك لتحديد الجهات الرقابية والأنظمة المنطبقة على هذه المنشأة بالذات.

القطاعات المتاحة في النظام (اختر الأقرب):
${sectorList.map((s) => `- ${s.id}: ${s.name}`).join("\n")}

قواعد تصميم الأسئلة:
- من ٤ إلى ٧ أسئلة، مرتبة من الأكثر أثراً على النتيجة.
- كل سؤال يجب أن يغيّر الإجابة فعلياً. لا تسأل سؤالاً لن يضيف جهة رقابية ولا يحرّك التزاماً.
- اجعلها خاصة بهذا النشاط لا أسئلة عامة. مثال: لمقهى اسأل عن التحميص والتوصيل والبيع أونلاين، لا "ما نوع نشاطك".
- كل سؤال يحمل "why": سطر يشرح ما الذي يترتب على الإجابة (أي جهة أو نظام يدخل أو يخرج).
- أضف دائماً سؤالاً عن حجم العمالة (يؤثر على السعودة ونطاقات) وسؤالاً عن بيانات العملاء إن كان النشاط يجمعها.
- ضع خيارات جاهزة كلما أمكن، ولا تلجأ لـ text إلا لما لا يُحصر.

الشكل المطلوب:
{"business":{"label":"وصف من ٣-٦ كلمات للنشاط","sectorIds":["أقرب قطاع","قطاع ثانٍ إن انطبق"],"note":"ملاحظة واحدة عن أبرز ما يميّز هذه المنشأة تنظيمياً"},"questions":[{"id":"معرّف_انجليزي_قصير","label":"نص السؤال","type":"single|multi|text|number","options":["خيار","خيار"],"why":"ما الذي يترتب على الإجابة"}]}

أعد JSON فقط. بلا markdown وبلا أي نص قبله أو بعده. بالعربية.`;
}

/** يصوغ إجابات الاستبيان في سطور نصية يفهمها نموذج التحليل */
export function formatAnswers(questions, answers) {
  return (questions || [])
    .map((q) => {
      const v = answers?.[q.id];
      const text = Array.isArray(v) ? v.join("، ") : v;
      return text ? `- ${q.label} → ${text}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * المرحلة ٢: التحليل الكامل.
 * نمرّر البنود المولّدة أسبوعياً كسياق مُثبت — النموذج يبحث للتحقق والإضافة،
 * لا لإعادة اكتشاف ما نعرفه أصلاً.
 */
export function analyzePrompt({ description, business, answersText, context }) {
  return `أنت مستشار امتثال تنظيمي في المملكة العربية السعودية.

ملف المنشأة:
- الوصف: ${String(description).slice(0, 1200)}
${business?.label ? `- النشاط: ${business.label}` : ""}

إجابات صاحب المنشأة:
${answersText || "(لم يجب على الاستبيان)"}

${context ? `بنود مرصودة مسبقاً من مسحنا الأسبوعي لهذه القطاعات (تحقق منها وابنِ عليها، ولا تكررها حرفياً إن لم تنطبق):\n${context}\n` : ""}
مهمتك:
ابحث في المصادر الرسمية السعودية وحدّد الالتزامات التنظيمية التي تنطبق على هذه المنشأة **بحسب ما وصفته تحديداً** — لا التزامات القطاع عموماً.

${STATUS_GUIDE}

**الجزاء هو أهم حقل في هذا التحليل.** صاحب المنشأة يريد أن يعرف كم يكلّفه الإخلال.
لذلك بعد أن تحدد الأنظمة المنطبقة، قم ببحث إضافي مخصّص للعقوبات باستخدام صيغ مثل:
- "<اسم النظام> جدول تصنيف المخالفات والعقوبات"
- "لائحة <اسم النظام> الغرامات ريال"
- "<اسم الجهة> جدول المخالفات pdf"

اذكر الغرامة بالريال كما وردت حرفياً في الجدول الرسمي (رقماً أو مدى: "من ٥٠٠٠ إلى ٥٠٠٠٠ ريال")،
مع الإشارة إلى العقوبات غير المالية إن وُجدت (إغلاق، إيقاف نشاط، سحب ترخيص).
لا تكتب "غير محدد في المصدر" إلا بعد أن تبحث فعلاً عن جدول المخالفات ولا تجده — لا تستخدمها كمهرب.

رتّب النتائج بالأولوية: ما يعرّض المنشأة لإغلاق أو غرامة كبيرة أولاً.

أعد من ٥ إلى ٩ بنود. وأضف "applies" لكل بند: جملة واحدة تربط البند بما ذكره صاحب المنشأة (مثال: "لأنك تبيع عبر متجر إلكتروني").

**صياغة المخالفة — مهم:**
لكل بند اكتب حقلين منفصلين:
- "violation" = المخالفة بالصياغة النظامية الرسمية كما وردت في النظام أو اللائحة.
- "plain" = نفس المخالفة بلغة صاحب المنشأة: جملة أو جملتان، بلا مصطلحات نظامية،
  تبدأ بفعل واضح يصف ما يقع فيه الخطأ عملياً. القارئ صاحب مقهى لا محامٍ.

مثال:
  violation: "تداول منتجات غذائية غير مطابقة لاشتراطات بطاقة البيانات الغذائية الإلزامية"
  plain: "تبيع منتجاً معبأً وما عليه ملصق يوضح المكوّنات وتاريخ الانتهاء والقيمة الغذائية بالعربي."

الشكل المطلوب:
{"summary":"فقرة قصيرة: أبرز ٣ مخاطر تنظيمية على هذه المنشأة تحديداً","agencies":["الجهات الرقابية المنطبقة"],"items":[{"name":"اسم النظام أو اللائحة","agency":"الجهة","applies":"لماذا ينطبق عليك أنت","status":"draft|issued|grace|enforced","statusNote":"التاريخ أو المهلة","summary":"بماذا يُلزم","violation":"المخالفة بالصياغة النظامية","plain":"نفس المخالفة بلغة بسيطة يفهمها صاحب المنشأة","penalty":"الجزاء كما ورد، أو: غير محدد في المصدر","severity":"high|medium|low","steps":["خطوة عملية","خطوة"],"source":"رابط رسمي"}],"gaps":["ما لم تتمكن من التحقق منه ويحتاج مراجعة بشرية"]}

${RULES}`;
}

/** تنظيف مخرجات التحليل الكامل — نفس ضمانات المسح الأسبوعي زائد حقل applies */
export function sanitizeAnalysis(raw, { citations = [] } = {}) {
  const items = sanitizeItems(raw?.items, {
    citations,
    max: 9,
    extra: (it) => ({
      agency: str(it.agency, 160),
      applies: str(it.applies, 240),
      plain: str(it.plain, 300),
    }),
  });

  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    summary: str(raw?.summary, 700),
    agencies: Array.isArray(raw?.agencies) ? raw.agencies.slice(0, 12).map((a) => str(a, 160)).filter(Boolean) : [],
    items,
    gaps: Array.isArray(raw?.gaps) ? raw.gaps.slice(0, 5).map((g) => str(g, 240)).filter(Boolean) : [],
  };
}

/** تنظيف الاستبيان — نمنع أسئلة بلا معرّف أو بخيارات فارغة */
export function sanitizeIntake(raw, sectorIds) {
  const TYPES = ["single", "multi", "text", "number"];
  const seen = new Set();

  const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
    .filter((q) => q && typeof q.label === "string" && q.label.trim())
    .map((q, i) => {
      let id = str(q.id, 40).replace(/[^a-zA-Z0-9_]/g, "") || `q${i}`;
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      const type = TYPES.includes(q.type) ? q.type : "text";
      const options = Array.isArray(q.options)
        ? q.options.slice(0, 8).map((o) => str(o, 90)).filter(Boolean)
        : [];
      return {
        id,
        label: str(q.label, 220),
        // نوع بخيارات بلا خيارات = حقل نصّي
        type: (type === "single" || type === "multi") && options.length < 2 ? "text" : type,
        options,
        why: str(q.why, 220),
      };
    })
    .slice(0, 8);

  const ids = new Set(sectorIds);
  return {
    business: {
      label: str(raw?.business?.label, 120) || "منشأة",
      sectorIds: (Array.isArray(raw?.business?.sectorIds) ? raw.business.sectorIds : [])
        .filter((s) => ids.has(s))
        .slice(0, 3),
      note: str(raw?.business?.note, 300),
    },
    questions,
  };
}
