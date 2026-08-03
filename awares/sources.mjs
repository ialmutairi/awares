/**
 * awares — التحقق من المصادر المقترحة من المستخدمين
 *
 * ⚠️ الخطر الحقيقي هنا ليس تقنياً بل خاص بالنزاهة:
 * أداة امتثال تعرض رابطاً أضافه مجهول وكأنه مرجع رسمي = ضرر مباشر على من يصدّقه.
 *
 * لذلك المقترحات **لا تدخل السجل المُتحقَّق منه أبداً**، ولا تُمرَّر للنموذج
 * كمصدر موثوق. تُعرض في قسم منفصل موسوم «مقترح من مستخدم — غير مراجَع»،
 * ولا تُرقّى إلى regulators.mjs إلا بمراجعة بشرية ويدوية.
 *
 * سلسلة الفحص أدناه ترفض ما يمكن رفضه آلياً قبل أن يُخزَّن أصلاً.
 */

import { officialSource, hostOf } from "./analysis.mjs";
import { REGULATORS, PRIMARY_SOURCES, regulatorsFor } from "./regulators.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export class SourceRejected extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** الصفحات العامة لا تصلح كمرجع لالتزام بعينه */
const TOO_GENERIC = /^\/?(ar|en)?\/?(pages\/)?(default\.aspx|home|index\.html?)?\/?$/i;

/**
 * ١) الشكل: رابط صالح بمخطط http(s)
 * ٢) الرسمية: المضيف ضمن السجل المُتحقَّق منه أو تحت gov.sa
 * ٣) العمق: ليس مجرد الصفحة الرئيسية
 * ٤) الحياة: يفتح فعلاً بحالة 200
 */
export async function validateSource(rawUrl, { fetchImpl = fetch } = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) throw new SourceRejected("empty", "ضع رابط المصدر.");
  if (url.length > 500) throw new SourceRejected("long", "الرابط طويل بشكل غير معقول.");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new SourceRejected("malformed", "هذا ليس رابطاً صالحاً. لا بد أن يبدأ بـ https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SourceRejected("scheme", "يُقبل https فقط.");
  }

  const clean = officialSource(url);
  if (!clean) {
    throw new SourceRejected(
      "unofficial",
      `المضيف «${parsed.hostname}» ليس جهة رسمية معروفة. نقبل نطاقات gov.sa والجهات المسجّلة فقط — لا المدونات ولا مكاتب المحاماة ولا الملخّصات.`
    );
  }

  if (TOO_GENERIC.test(parsed.pathname) && !parsed.search) {
    throw new SourceRejected(
      "generic",
      "هذه الصفحة الرئيسية للجهة. ضع رابط المستند نفسه — النظام أو اللائحة أو جدول المخالفات."
    );
  }

  // الحياة: نتحقق فعلاً أن الرابط يفتح، فلا نخزّن 404
  let status = 0;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    const res = await fetchImpl(clean, {
      redirect: "follow",
      headers: { "user-agent": UA },
      signal: ctl.signal,
    }).finally(() => clearTimeout(t));
    status = res.status;
  } catch {
    throw new SourceRejected("unreachable", "تعذّر فتح الرابط. تأكد أنه يعمل ثم أعد المحاولة.");
  }
  if (status === 404 || status === 410) {
    throw new SourceRejected("dead", `الرابط يعيد ${status} — الصفحة غير موجودة.`);
  }
  if (status >= 400 && status !== 403) {
    // 403 شائع في جدران الحماية الحكومية ولا يعني أن الصفحة غير موجودة
    throw new SourceRejected("badstatus", `الرابط يعيد ${status}.`);
  }

  const host = hostOf(clean);
  const known =
    REGULATORS.find((r) => r.host === host || (r.alt || []).includes(host)) ||
    PRIMARY_SOURCES.find((p) => p.host === host || p.deepHost === host);

  return {
    url: clean,
    host,
    status,
    regulator: known ? known.name : null,
  };
}

/** هل الجهة صاحبة الرابط منطقية لهذا القطاع؟ تنبيه لا رفض */
export function sectorHint(sectorId, host) {
  const list = regulatorsFor(sectorId);
  if (!list.length) return null;
  const inSector = list.some((r) => r.host === host || (r.alt || []).includes(host));
  return inSector
    ? null
    : "ملاحظة: هذه الجهة ليست ضمن جهات هذا القطاع في سجلّنا — سنراجعها.";
}
