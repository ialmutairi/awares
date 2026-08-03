#!/usr/bin/env node
/**
 * awares — التحقق من سجل الجهات
 *
 * يفحص كل نطاق في regulators.mjs حياً ويقول أيّها مات أو تحوّل.
 * شغّله قبل أي إطلاق، وكل بضعة أشهر — الجهات السعودية تُدمج وتُعاد تسميتها كثيراً،
 * وأربعة نطاقات في أول فحص كانت ميتة رغم شهرتها.
 *
 *   node verify-regulators.mjs
 *   node verify-regulators.mjs --json
 */

import { lookup } from "node:dns/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PRIMARY_SOURCES, REGULATORS } from "./regulators.mjs";

const execFileP = promisify(execFile);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * احتياطي بـ curl.
 * بصمة TLS الخاصة بـ undici تُحجب في جدران حماية عدة مواقع حكومية،
 * فيفشل fetch حيث ينجح curl. بدون هذا الاحتياطي نُبلّغ عن نطاقات حيّة كأنها ميتة.
 */
async function curlCheck(host) {
  for (const h of [host, `www.${host}`]) {
    try {
      const { stdout } = await execFileP(
        "curl",
        ["-sS", "-o", "/dev/null", "-m", "30", "-L", "-A", UA, "-w", "%{http_code}|%{url_effective}", `https://${h}/`],
        { timeout: 40000 }
      );
      const [code, url] = stdout.trim().split("|");
      if (code && code !== "000") return { code: Number(code), url };
    } catch {}
  }
  return null;
}

async function check(host) {
  // ١) DNS: غياب سجل A دليل قاطع على أن النطاق لم يعد قائماً
  let dns = null;
  try {
    dns = (await lookup(host)).address;
  } catch {
    return { host, dns: null, status: 0, verdict: "ميت — لا سجل DNS" };
  }

  // ٢) HTTP: قد يردّ 403 بسبب جدار حماية، وهذا لا يعني أنه ميت
  for (const h of [host, `www.${host}`]) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(`https://${h}/`, {
        redirect: "follow",
        headers: { "user-agent": UA },
        signal: ctl.signal,
      }).finally(() => clearTimeout(t));

      const finalHost = new URL(res.url).hostname.replace(/^www\./, "");
      return {
        host,
        dns,
        status: res.status,
        finalHost,
        verdict:
          finalHost !== host && finalHost !== `www.${host}`
            ? `يحوّل إلى ${finalHost}`
            : res.ok
            ? "سليم"
            : `HTTP ${res.status} — غالباً جدار حماية`,
      };
    } catch {}
  }

  // ٣) fetch فشل — نجرّب curl قبل الحكم بالموت
  const c = await curlCheck(host);
  if (c) {
    const finalHost = new URL(c.url).hostname.replace(/^www\./, "");
    return {
      host,
      dns,
      status: c.code,
      finalHost,
      verdict:
        finalHost !== host
          ? `يحوّل إلى ${finalHost}`
          : c.code < 400
          ? "سليم (عبر curl)"
          : `HTTP ${c.code} — غالباً جدار حماية`,
    };
  }
  return { host, dns, status: 0, verdict: "DNS موجود لكن HTTP فشل — تحقق يدوياً" };
}

const all = [
  ...PRIMARY_SOURCES.map((s) => ({ ...s, kind: "مصدر مرجعي" })),
  ...REGULATORS.map((r) => ({ ...r, kind: "جهة" })),
];

const results = [];
const CONC = 8;
let i = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (i < all.length) {
      const item = all[i++];
      results.push({ ...item, ...(await check(item.host)) });
    }
  })
);

results.sort((a, b) => a.host.localeCompare(b.host));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const bad = [];
  for (const r of results) {
    const sick = r.verdict.startsWith("ميت") || r.verdict.includes("تحقق يدوياً");
    const moved = r.verdict.startsWith("يحوّل");
    const icon = sick ? "✗" : moved ? "→" : "✓";
    if (sick || moved) bad.push(r);
    console.log(`${icon} ${r.host.padEnd(24)} ${r.verdict.padEnd(30)} ${r.name}`);
  }
  console.log(`\n${results.length - bad.length}/${results.length} سليم`);
  if (bad.length) {
    console.log(`\nيحتاج مراجعة (${bad.length}):`);
    for (const r of bad) console.log(`  ${r.host} — ${r.verdict} — ${r.name}`);
    process.exit(1);
  }
}
