/**
 * enrich-radar.ts
 *
 * 为「小白雷达页」生成易懂文案。对最新一天 new-projects.json 里评分最高的
 * 前 N 个项目，抓取各自 README，调用大模型翻译成三段大白话：
 *   - whatIs     这是什么（一句话本质，零术语）
 *   - forYou     你能用它做什么（具体用途）
 *   - whyMatters 为什么对你重要（对一个不懂技术的人的价值）
 * 并归入固定分类，便于页面筛选。
 *
 * 结果写入 digests/<date>/radar-enriched.json，供 scripts/build-radar-page.mjs 使用。
 * 带缓存：项目自上次以来没有新提交（pushedAt 未变）则直接复用旧文案，不再花 token。
 *
 * 用法： pnpm enrich      （需要与主流程相同的 LLM 环境变量）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callLlm } from "../src/report.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const digestsDir = join(root, "digests");

const MAX = Number(process.env.RADAR_MAX || 20);

const CATEGORIES = [
  "用 AI 做东西",
  "让 AI 帮你写代码",
  "省钱与提效",
  "让 AI 自动干活",
  "给 AI 加记忆 / 学原理",
] as const;

type Item = {
  fullName: string;
  pushedAt?: string;
  category: string;
  whatIs: string;
  forYou: string;
  whyMatters: string;
};

function findLatest(): { date: string; file: string } | null {
  if (!existsSync(digestsDir)) return null;
  const days = readdirSync(digestsDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => existsSync(join(digestsDir, d, "new-projects.json")))
    .sort();
  if (!days.length) return null;
  const date = days[days.length - 1];
  return { date, file: join(digestsDir, date, "new-projects.json") };
}

async function fetchReadme(fullName: string): Promise<string> {
  const branches = ["main", "master"];
  const files = ["README.md", "readme.md", "README.zh.md", "README_CN.md"];
  for (const br of branches) {
    for (const fn of files) {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${fullName}/${br}/${fn}`,
        );
        if (res.ok) {
          const text = await res.text();
          if (text.trim()) return text;
        }
      } catch {
        /* try next */
      }
    }
  }
  return "";
}

function stripMarkdown(md: string): string {
  return md
    .split("\n")
    .filter((l) => {
      const s = l.trim();
      if (!s) return false;
      if (/(badge|shields|\.svg|\.png|\.gif)/i.test(s)) return false;
      if (/^<(img|div|p align|a href|picture|source|br)/i.test(s)) return false;
      return true;
    })
    .join("\n")
    .slice(0, 2800);
}

function buildPrompt(p: {
  fullName: string;
  descriptionZh?: string;
  language?: string;
  readme: string;
}): string {
  return `你是面向「编程小白」的技术翻译。读下面这个 GitHub 项目的 README，用最朴素的中文讲清楚，让一个完全不懂技术的人也能看懂。

项目：${p.fullName}（主要语言：${p.language || "未知"}）
已有简介：${p.descriptionZh || "（无）"}

README 节选：
"""
${p.readme || "（抓取失败，请只依据上面的已有简介，谨慎概括）"}
"""

请只输出一个 JSON 对象，字段如下（每段都用大白话，不堆术语；出现术语必须顺手解释）：
{
  "category": 从这几个里选最贴切的一个：${CATEGORIES.map((c) => `"${c}"`).join("、")},
  "whatIs": "是什么——一句话讲清它的本质（≤45字，像跟朋友解释）",
  "forYou": "你能用它做什么——具体、能想象的用途（≤55字）",
  "whyMatters": "为什么对你重要——对一个不懂技术的普通人来说，它解决了什么麻烦、什么时候会想用（≤55字）"
}
只输出 JSON，不要任何解释或代码块标记。`;
}

function parseJson(text: string): Partial<Item> | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function main() {
  const latest = findLatest();
  if (!latest) {
    console.error("[enrich] 没找到 new-projects.json，先跑 pnpm new-projects");
    process.exit(0);
  }
  const raw = JSON.parse(readFileSync(latest.file, "utf8"));
  const top = (raw.projects || [])
    .slice()
    .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
    .slice(0, MAX);

  // 载入旧缓存（按 fullName 索引）
  const outPath = join(digestsDir, latest.date, "radar-enriched.json");
  const cache = new Map<string, Item>();
  if (existsSync(outPath)) {
    try {
      for (const it of JSON.parse(readFileSync(outPath, "utf8")).items || []) {
        if (it?.fullName) cache.set(it.fullName, it);
      }
    } catch {
      /* ignore */
    }
  }

  let made = 0;
  let reused = 0;
  const items: Item[] = await Promise.all(
    top.map(async (p: any): Promise<Item> => {
      const prev = cache.get(p.fullName);
      // 没有新提交则复用旧文案
      if (prev && prev.pushedAt && prev.pushedAt === p.pushedAt && prev.whatIs) {
        reused++;
        return prev;
      }
      const readme = stripMarkdown(await fetchReadme(p.fullName));
      const out = parseJson(
        await callLlm(
          buildPrompt({
            fullName: p.fullName,
            descriptionZh: p.descriptionZh,
            language: p.language,
            readme,
          }),
          700,
        ),
      );
      made++;
      const category =
        out?.category && (CATEGORIES as readonly string[]).includes(out.category)
          ? out.category
          : prev?.category || "让 AI 自动干活";
      return {
        fullName: p.fullName,
        pushedAt: p.pushedAt,
        category,
        whatIs: out?.whatIs || prev?.whatIs || p.descriptionZh || "",
        forYou: out?.forYou || prev?.forYou || "",
        whyMatters: out?.whyMatters || prev?.whyMatters || "",
      };
    }),
  );

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        version: 1,
        date: latest.date,
        generatedAt: new Date().toISOString(),
        note: "小白文案：whatIs=是什么 / forYou=能做什么 / whyMatters=为什么重要。由 scripts/enrich-radar.ts 生成。",
        items,
      },
      null,
      2,
    ),
  );
  console.log(
    `[enrich] 已写入 ${outPath}：共 ${items.length} 个（新生成 ${made}，复用缓存 ${reused}）`,
  );
}

main().catch((e) => {
  console.error("[enrich] 失败：", e);
  process.exit(1);
});
