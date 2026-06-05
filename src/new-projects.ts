/**
 * GitHub new-project radar.
 *
 * This script is intentionally LLM-free so scheduled runs only need the
 * built-in GITHUB_TOKEN. It searches for newly created GitHub repositories,
 * ranks them with deterministic signals, and writes Markdown reports that the
 * existing GitHub Pages UI can render.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { createGitHubIssue } from "./github.ts";
import { sleep, toCstDateStr, toUtcStr } from "./date.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewProjectQuery {
  label: string;
  q: string;
  category?: string;
  weight?: number;
}

export interface NewProjectsConfig {
  lookbackDays: number;
  minStars: number;
  maxResults: number;
  perQuery: number;
  createIssue: boolean;
  queries: NewProjectQuery[];
  exclude: string[];
}

interface RawNewProjectsSection {
  lookback_days?: unknown;
  min_stars?: unknown;
  max_results?: unknown;
  per_query?: unknown;
  create_issue?: unknown;
  queries?: unknown;
  exclude?: unknown;
}

interface RawConfig {
  new_projects?: RawNewProjectsSection;
}

interface SearchRepoOwner {
  login?: string;
  avatar_url?: string;
}

interface SearchRepoLicense {
  spdx_id?: string | null;
}

interface SearchRepoItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  homepage?: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  owner?: SearchRepoOwner;
  license?: SearchRepoLicense | null;
}

interface SearchApiResponse {
  total_count?: number;
  incomplete_results?: boolean;
  items?: SearchRepoItem[];
}

export interface NewProject {
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  openIssues: number;
  topics: string[];
  homepage: string;
  license: string;
  owner: string;
  ownerAvatarUrl: string;
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  matchedQueries: string[];
  matchedCategories: string[];
  searchQueries: string[];
  categoryZh: string;
  categoryEn: string;
  score: number;
  aiPotentialScore: number;
  webTrendScore: number;
  reasonsZh: string[];
  reasonsEn: string[];
  frontierReasonsZh: string[];
  frontierReasonsEn: string[];
  webTrendReasonsZh: string[];
  webTrendReasonsEn: string[];
  trendLabelsZh: string[];
  trendLabelsEn: string[];
}

interface DigestMeta {
  dateStr: string;
  utcStr: string;
  sinceDate: string;
  generatedAt: string;
  lookbackDays: number;
  totalRaw: number;
  totalUnique: number;
  activeQueries: NewProjectQuery[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_QUERIES: NewProjectQuery[] = [
  {
    label: "Web",
    category: "Web / Frontend",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:web",
    weight: 12,
  },
  {
    label: "Frontend",
    category: "Web / Frontend",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:frontend",
    weight: 12,
  },
  {
    label: "React",
    category: "Web / Frontend",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:react",
    weight: 10,
  },
  {
    label: "Next.js",
    category: "Web / Frontend",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:nextjs",
    weight: 10,
  },
  {
    label: "Vite",
    category: "Web / Frontend",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:vite",
    weight: 8,
  },
  {
    label: "TypeScript Web Apps",
    category: "Web / Frontend",
    q: "web app in:name,description created:>={since} pushed:>={since} stars:>={minStars} language:TypeScript",
    weight: 9,
  },
  {
    label: "Mobile Apps",
    category: "Mobile / Apps",
    q: "mobile app in:name,description created:>={since} pushed:>={since} stars:>={minStars}",
    weight: 12,
  },
  {
    label: "iOS Apps",
    category: "Mobile / Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:ios",
    weight: 11,
  },
  {
    label: "Android Apps",
    category: "Mobile / Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:android",
    weight: 11,
  },
  {
    label: "Flutter Apps",
    category: "Mobile / Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:flutter",
    weight: 10,
  },
  {
    label: "React Native Apps",
    category: "Mobile / Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:react-native",
    weight: 10,
  },
  {
    label: "Expo Apps",
    category: "Mobile / Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:expo",
    weight: 9,
  },
  {
    label: "Swift Apps",
    category: "Mobile / Apps",
    q: "app in:name,description created:>={since} pushed:>={since} stars:>={minStars} language:Swift",
    weight: 9,
  },
  {
    label: "Kotlin Apps",
    category: "Mobile / Apps",
    q: "app in:name,description created:>={since} pushed:>={since} stars:>={minStars} language:Kotlin",
    weight: 9,
  },
  {
    label: "Product Apps",
    category: "Product Apps",
    q: "product app in:name,description created:>={since} pushed:>={since} stars:>={minStars}",
    weight: 10,
  },
  {
    label: "Developer Tools",
    category: "Developer Tools",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:developer-tools",
    weight: 11,
  },
  {
    label: "CLI Tools",
    category: "Developer Tools",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:cli",
    weight: 8,
  },
  {
    label: "Coding Agents",
    category: "AI Coding / Agents",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:ai-agent",
    weight: 13,
  },
  {
    label: "Code Generation",
    category: "AI Coding / Agents",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:code-generation",
    weight: 12,
  },
  {
    label: "MCP",
    category: "AI Coding / Agents",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:mcp",
    weight: 11,
  },
  {
    label: "LLM Apps",
    category: "AI Apps",
    q: "created:>={since} pushed:>={since} stars:>={minStars} topic:llm",
    weight: 9,
  },
];

const DEFAULT_EXCLUDES = [
  "awesome",
  "roadmap",
  "interview",
  "leetcode",
  "dotfiles",
  "notes",
  "course",
  "homework",
  "assignment",
  "tutorial",
];

const WEB_WORDS = [
  "web",
  "frontend",
  "front-end",
  "react",
  "nextjs",
  "next.js",
  "vite",
  "vue",
  "svelte",
  "tailwind",
  "dashboard",
  "browser",
  "extension",
  "fullstack",
  "full-stack",
];

const AI_CODING_WORDS = [
  "agent",
  "ai-agent",
  "coding agent",
  "code generation",
  "codegen",
  "copilot",
  "assistant",
  "llm",
  "mcp",
  "rag",
  "prompt",
  "claude",
  "openai",
  "codex",
];

const DEVTOOL_WORDS = [
  "cli",
  "sdk",
  "api",
  "developer",
  "devtool",
  "framework",
  "runtime",
  "toolkit",
  "library",
  "debug",
  "testing",
  "deploy",
  "workflow",
  "automation",
];

const PRODUCT_WORDS = [
  "app",
  "product",
  "platform",
  "studio",
  "builder",
  "editor",
  "dashboard",
  "workspace",
  "demo",
  "launch",
  "saas",
  "mobile",
  "ios",
  "android",
  "flutter",
  "react-native",
  "expo",
  "swift",
  "kotlin",
  "electron",
  "tauri",
];

const MOBILE_APP_WORDS = [
  "mobile",
  "mobile app",
  "app",
  "ios",
  "iphone",
  "ipad",
  "android",
  "flutter",
  "react-native",
  "react native",
  "expo",
  "swift",
  "swiftui",
  "kotlin",
  "jetpack compose",
  "compose",
  "app store",
  "play store",
  "firebase",
  "supabase",
  "offline-first",
  "wearos",
  "watchos",
];

const FRONTIER_AI_WORDS = [
  "agent",
  "ai-agent",
  "coding agent",
  "autonomous",
  "mcp",
  "llm",
  "rag",
  "eval",
  "benchmark",
  "codex",
  "claude",
  "cursor",
  "copilot",
  "prompt",
  "prompt-engineering",
  "workflow",
  "automation",
  "tool use",
  "browser agent",
  "multimodal",
  "voice",
  "image-generation",
  "local model",
];

const WEB_CODING_PRODUCT_WORDS = [
  "web",
  "frontend",
  "front-end",
  "react",
  "nextjs",
  "next.js",
  "vite",
  "typescript",
  "tailwind",
  "component",
  "app",
  "dashboard",
  "studio",
  "builder",
  "editor",
  "template",
  "starter",
  "extension",
  "workflow",
  "automation",
  "saas",
  "demo",
  "mobile",
  "ios",
  "android",
  "flutter",
  "react-native",
  "expo",
  "swift",
  "swiftui",
  "kotlin",
  "app store",
  "play store",
  "offline-first",
];

const TREND_PATTERNS = [
  {
    zh: "用 AI 帮人写代码或自动做事",
    en: "AI coding collaboration / agent workflows",
    words: ["agent", "ai-agent", "coding", "codex", "claude", "cursor", "copilot", "skill", "prompt"],
  },
  {
    zh: "帮做软件的人看懂项目、少踩坑",
    en: "Codebase understanding and developer tools",
    words: ["repo", "codebase", "cli", "developer-tools", "static-analysis", "sdk", "api", "toolkit"],
  },
  {
    zh: "做网站页面和产品原型",
    en: "Next.js / React product prototypes",
    words: ["nextjs", "next.js", "react", "vite", "typescript", "frontend", "web", "dashboard", "app"],
  },
  {
    zh: "做手机 App 和应用产品",
    en: "Mobile and app products",
    words: [
      "mobile",
      "mobile app",
      "ios",
      "iphone",
      "android",
      "flutter",
      "react-native",
      "expo",
      "swift",
      "kotlin",
    ],
  },
  {
    zh: "一套代码做多个平台的 App",
    en: "Cross-platform mobile frameworks",
    words: [
      "flutter",
      "react-native",
      "react native",
      "expo",
      "tauri",
      "electron",
      "swiftui",
      "jetpack compose",
    ],
  },
  {
    zh: "普通用户会用的个人工具",
    en: "Consumer apps and personal tools",
    words: ["habit", "fitness", "health", "finance", "notes", "calendar", "todo", "photo", "music", "social"],
  },
  {
    zh: "检查安全风险",
    en: "Security, governance and OSINT",
    words: ["security", "abuse", "spam", "osint", "moderation", "deanonymization"],
  },
  {
    zh: "做设计、图片或内容",
    en: "Design and content generation",
    words: ["design", "illustration", "image-generation", "studio", "editor", "creative", "long-scroll"],
  },
  {
    zh: "现成模板，方便快速开工",
    en: "Templates and starter kits",
    words: ["template", "starter", "boilerplate", "kit", "components"],
  },
  {
    zh: "把重复工作自动化",
    en: "Automation workflows",
    words: ["automation", "workflow", "daily-report", "report", "scheduler"],
  },
];

const QUERY_LABEL_ZH: Record<string, string> = {
  Web: "网站项目",
  Frontend: "网页界面项目",
  React: "网站页面项目",
  "Next.js": "完整网站应用",
  Vite: "轻量网站项目",
  "TypeScript Web Apps": "网页应用",
  "Mobile Apps": "手机应用",
  "iOS Apps": "苹果手机应用",
  "Android Apps": "安卓手机应用",
  "Flutter Apps": "多端手机应用",
  "React Native Apps": "跨平台手机应用",
  "Expo Apps": "快速开发的手机应用",
  "Swift Apps": "苹果应用",
  "Kotlin Apps": "安卓应用",
  "Product Apps": "产品应用",
  "Developer Tools": "开发工具",
  "CLI Tools": "终端工具",
  "Coding Agents": "AI 写代码工具",
  "Code Generation": "自动生成代码",
  MCP: "让 AI 连接外部工具",
  "LLM Apps": "聊天 AI 应用",
};

const CATEGORY_LABEL_ZH: Record<string, string> = {
  "Web / Frontend": "网站/网页",
  "Mobile / Apps": "手机/App",
  "Product Apps": "产品应用",
  "Developer Tools": "开发工具",
  "AI Coding / Agents": "AI 工具",
  "AI Apps": "AI 应用",
};

const SIGNAL_LABEL_ZH: Record<string, string> = {
  web: "网页",
  frontend: "网页界面",
  "front-end": "网页界面",
  react: "网页界面",
  nextjs: "完整网站应用",
  "next.js": "完整网站应用",
  vite: "轻量网站工具",
  vue: "网页界面",
  svelte: "网页界面",
  tailwind: "网页样式",
  dashboard: "数据面板",
  browser: "浏览器",
  extension: "浏览器扩展",
  fullstack: "完整网站",
  "full-stack": "完整网站",
  agent: "AI 自动做事",
  "ai-agent": "AI 自动做事",
  "coding agent": "AI 帮写代码",
  autonomous: "AI 自己执行",
  mcp: "让 AI 连接外部工具",
  llm: "聊天 AI",
  rag: "让 AI 查资料后回答",
  eval: "效果评测",
  benchmark: "对比评测",
  codex: "编程助手",
  claude: "编程助手",
  cursor: "智能编辑器",
  copilot: "编程助手",
  prompt: "给 AI 的指令",
  "prompt-engineering": "写好 AI 指令",
  workflow: "工作流",
  automation: "自动化",
  "tool use": "调用工具",
  "browser agent": "AI 控制浏览器",
  multimodal: "多模态",
  voice: "语音",
  "image-generation": "图像生成",
  "local model": "本地 AI 模型",
  cli: "终端工具",
  sdk: "开发工具包",
  api: "数据接口",
  developer: "做软件的人",
  devtool: "开发工具",
  framework: "开发框架",
  runtime: "运行环境",
  toolkit: "工具包",
  library: "组件库",
  debug: "调试",
  testing: "测试",
  deploy: "部署",
  app: "应用",
  product: "产品",
  platform: "平台",
  studio: "工作室",
  builder: "搭建器",
  editor: "编辑器",
  workspace: "工作台",
  demo: "演示",
  launch: "发布",
  saas: "在线服务",
  mobile: "手机端",
  ios: "iOS",
  iphone: "iPhone",
  ipad: "iPad",
  android: "安卓",
  flutter: "一套代码做多个平台的 App",
  "react-native": "一套代码做多个平台的 App",
  "react native": "一套代码做多个平台的 App",
  expo: "快速做手机 App",
  swift: "苹果 App",
  swiftui: "苹果界面工具",
  kotlin: "安卓开发",
  "jetpack compose": "安卓界面工具",
  compose: "界面工具",
  "app store": "应用商店",
  "play store": "安卓应用商店",
  firebase: "移动后端",
  supabase: "应用后端",
  "offline-first": "离线优先",
  wearos: "穿戴设备",
  watchos: "腕表应用",
  electron: "桌面应用工具",
  tauri: "桌面应用工具",
  component: "组件",
  template: "模板",
  starter: "脚手架",
  typescript: "常用网页开发语言",
  javascript: "网页脚本语言",
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeQueries(value: unknown): NewProjectQuery[] {
  if (!Array.isArray(value)) return DEFAULT_QUERIES;

  const queries = value
    .map((entry): NewProjectQuery | null => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const label = typeof raw["label"] === "string" ? raw["label"].trim() : "";
      const q = typeof raw["q"] === "string" ? raw["q"].trim() : "";
      if (!label || !q) return null;
      const category = typeof raw["category"] === "string" ? raw["category"].trim() : undefined;
      const weight = asNumber(raw["weight"], 8, 0, 30);
      return { label, q, ...(category ? { category } : {}), weight };
    })
    .filter((query): query is NewProjectQuery => query !== null);

  return queries.length > 0 ? queries : DEFAULT_QUERIES;
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  return list.filter(Boolean);
}

export function loadNewProjectsConfig(configPath = "config.yml"): NewProjectsConfig {
  const resolved = path.resolve(configPath);
  const raw = fs.existsSync(resolved)
    ? (yaml.load(fs.readFileSync(resolved, "utf-8")) as RawConfig | undefined)
    : undefined;
  const section = raw?.new_projects;

  const envLookback = process.env["NEW_PROJECTS_LOOKBACK_DAYS"];
  const envMinStars = process.env["NEW_PROJECTS_MIN_STARS"];
  const envMaxResults = process.env["NEW_PROJECTS_MAX_RESULTS"];
  const envPerQuery = process.env["NEW_PROJECTS_PER_QUERY"];
  const envCreateIssue = process.env["NEW_PROJECTS_CREATE_ISSUE"];

  return {
    lookbackDays: asNumber(envLookback ?? section?.lookback_days, 90, 1, 120),
    minStars: asNumber(envMinStars ?? section?.min_stars, 2, 0, 1000),
    maxResults: asNumber(envMaxResults ?? section?.max_results, 40, 5, 200),
    perQuery: asNumber(envPerQuery ?? section?.per_query, 25, 5, 100),
    createIssue: asBoolean(envCreateIssue ?? section?.create_issue, false),
    queries: normalizeQueries(section?.queries),
    exclude: normalizeStringList(section?.exclude, DEFAULT_EXCLUDES),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function materializeQuery(template: string, sinceDate: string, minStars: number): string {
  let query = template.replaceAll("{since}", sinceDate).replaceAll("{minStars}", String(minStars));
  if (!/\bcreated:/.test(query)) query += ` created:>=${sinceDate}`;
  if (!/\bstars:/.test(query)) query += ` stars:>=${minStars}`;
  if (!/\bfork:/.test(query)) query += " fork:false";
  if (!/\barchived:/.test(query)) query += " archived:false";
  return query.replace(/\s+/g, " ").trim();
}

function githubHeaders(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"] ?? "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agents-radar-new-projects/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function searchRepositories(
  query: NewProjectQuery,
  renderedQuery: string,
  perQuery: number,
): Promise<SearchRepoItem[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", renderedQuery);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(perQuery));

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(url.toString(), { headers: githubHeaders() });
    if (!resp.ok) {
      const reset = resp.headers.get("x-ratelimit-reset");
      const resetMs = reset ? Number(reset) * 1000 - Date.now() : 0;
      if ((resp.status === 403 || resp.status === 429) && attempt === 0 && resetMs > 0 && resetMs < 120_000) {
        const waitMs = Math.ceil(resetMs + 1_000);
        console.log(
          `  [new-projects/${query.label}] Rate limited, retrying in ${Math.ceil(waitMs / 1000)}s...`,
        );
        await sleep(waitMs);
        continue;
      }

      const resetText = reset ? `, reset=${new Date(Number(reset) * 1000).toISOString()}` : "";
      const body = await resp.text();
      console.error(`  [new-projects/${query.label}] GitHub search HTTP ${resp.status}${resetText}: ${body}`);
      return [];
    }

    const data = (await resp.json()) as SearchApiResponse;
    if (data.incomplete_results) {
      console.log(`  [new-projects/${query.label}] GitHub returned incomplete results.`);
    }
    return data.items ?? [];
  }

  return [];
}

function repoFromSearchItem(item: SearchRepoItem, query: NewProjectQuery, renderedQuery: string): NewProject {
  return {
    fullName: item.full_name,
    url: item.html_url,
    description: item.description ?? "",
    language: item.language ?? "",
    stars: item.stargazers_count ?? 0,
    forks: item.forks_count ?? 0,
    openIssues: item.open_issues_count ?? 0,
    topics: Array.isArray(item.topics) ? item.topics : [],
    homepage: item.homepage ?? "",
    license: item.license?.spdx_id ?? "",
    owner: item.owner?.login ?? item.full_name.split("/")[0] ?? "",
    ownerAvatarUrl: item.owner?.avatar_url ?? "",
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    updatedAt: item.updated_at,
    matchedQueries: [query.label],
    matchedCategories: [query.category ?? query.label],
    searchQueries: [renderedQuery],
    categoryZh: "",
    categoryEn: "",
    score: 0,
    aiPotentialScore: 0,
    webTrendScore: 0,
    reasonsZh: [],
    reasonsEn: [],
    frontierReasonsZh: [],
    frontierReasonsEn: [],
    webTrendReasonsZh: [],
    webTrendReasonsEn: [],
    trendLabelsZh: [],
    trendLabelsEn: [],
  };
}

function mergeProject(existing: NewProject, incoming: NewProject): void {
  existing.matchedQueries = unique([...existing.matchedQueries, ...incoming.matchedQueries]);
  existing.matchedCategories = unique([...existing.matchedCategories, ...incoming.matchedCategories]);
  existing.searchQueries = unique([...existing.searchQueries, ...incoming.searchQueries]);

  if (!existing.description && incoming.description) existing.description = incoming.description;
  if (!existing.homepage && incoming.homepage) existing.homepage = incoming.homepage;
  if (!existing.license && incoming.license) existing.license = incoming.license;
  if (incoming.topics.length > existing.topics.length) existing.topics = incoming.topics;
}

function shouldExclude(project: NewProject, exclude: string[]): boolean {
  const haystack = normalizeText(
    `${project.fullName} ${project.description} ${project.topics.join(" ")} ${project.matchedQueries.join(" ")}`,
  );
  if (project.forks === 0 && /\/[a-z0-9][a-z0-9-]*-\d{3,}$/i.test(project.fullName)) return true;
  return exclude.some((word) => haystack.includes(normalizeText(word)));
}

export async function collectNewProjects(
  config: NewProjectsConfig,
  sinceDate: string,
  now = new Date(),
): Promise<{ projects: NewProject[]; totalRaw: number; activeQueries: NewProjectQuery[] }> {
  const hasToken = Boolean(process.env["GITHUB_TOKEN"]);
  const activeQueries = config.queries;
  if (!hasToken) {
    console.log("  [new-projects] GITHUB_TOKEN is not set, running all queries with rate-limit backoff.");
  }

  const byName = new Map<string, NewProject>();
  let totalRaw = 0;

  for (const query of activeQueries) {
    const rendered = materializeQuery(query.q, sinceDate, config.minStars);
    const items = await searchRepositories(query, rendered, config.perQuery);
    totalRaw += items.length;
    let added = 0;

    for (const item of items) {
      const incoming = repoFromSearchItem(item, query, rendered);
      if (shouldExclude(incoming, config.exclude)) continue;

      const key = incoming.fullName.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        mergeProject(existing, incoming);
      } else {
        byName.set(key, incoming);
        added++;
      }
    }

    console.log(`  [new-projects/${query.label}] raw=${items.length}, added=${added}`);
  }

  return {
    projects: rankProjects([...byName.values()], config, now),
    totalRaw,
    activeQueries,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function queryLabelZh(label: string): string {
  return QUERY_LABEL_ZH[label] ?? label;
}

function categoryLabelZh(label: string): string {
  return CATEGORY_LABEL_ZH[label] ?? label;
}

function signalLabelZh(label: string): string {
  return SIGNAL_LABEL_ZH[normalizeText(label)] ?? label;
}

function labelListZh(labels: string[]): string {
  return unique(labels.map(signalLabelZh)).join(", ");
}

function queryListZh(labels: string[]): string {
  return unique(labels.map(queryLabelZh)).join(", ");
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function plainCategoryZh(project: NewProject): string {
  const category = project.categoryZh || "";
  if (category.includes("手机") || category.includes("App") || category.includes("移动"))
    return "手机或 App 项目";
  if (category.includes("AI")) return "AI 工具";
  if (category.includes("网站") || category.includes("网页")) return "网站或网页应用";
  if (category.includes("开发")) return "开发工具";
  if (category.includes("产品")) return "产品应用";
  return "新项目";
}

function displayDescriptionZh(project: NewProject): string {
  const category = plainCategoryZh(project);
  const prefix = category.startsWith("AI") ? "一个 " : "一个";
  return `这是${prefix}${category}。可以先看它解决什么问题、有没有真实页面，以及最近是否还在更新。`;
}

function keywordHits(text: string, words: string[]): string[] {
  const normalized = normalizeText(text);
  return words.filter((word) => normalized.includes(normalizeText(word)));
}

function hoursSince(dateValue: string, now: Date): number {
  const t = Date.parse(dateValue);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / 3_600_000);
}

function ageZh(dateValue: string, now: Date): string {
  const hours = hoursSince(dateValue, now);
  if (!Number.isFinite(hours)) return "时间未知";
  if (hours < 24) return `${Math.max(1, Math.round(hours))} 小时前`;
  return `${Math.max(1, Math.round(hours / 24))} 天前`;
}

function ageEn(dateValue: string, now: Date): string {
  const hours = hoursSince(dateValue, now);
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h ago`;
  return `${Math.max(1, Math.round(hours / 24))}d ago`;
}

function hasMobileAppSignal(project: NewProject): boolean {
  const text = `${project.fullName} ${project.description} ${project.language} ${project.topics.join(" ")} ${project.matchedQueries.join(
    " ",
  )} ${project.matchedCategories.join(" ")}`;
  return (
    project.matchedCategories.includes("Mobile / Apps") ||
    project.matchedCategories.includes("Product Apps") ||
    keywordHits(text, MOBILE_APP_WORDS).length >= 2
  );
}

function classifyProject(project: NewProject): { zh: string; en: string } {
  const text = `${project.fullName} ${project.description} ${project.language} ${project.topics.join(" ")} ${project.matchedCategories.join(
    " ",
  )}`;
  const aiHits = keywordHits(text, AI_CODING_WORDS).length;
  const webHits = keywordHits(text, WEB_WORDS).length;
  const mobileHits = keywordHits(text, MOBILE_APP_WORDS).length;
  const devtoolHits = keywordHits(text, DEVTOOL_WORDS).length;
  const productHits = keywordHits(text, PRODUCT_WORDS).length;

  if (hasMobileAppSignal(project) || mobileHits >= 2) return { zh: "手机/App 项目", en: "Mobile / Apps" };
  if (aiHits >= 2) return { zh: "AI 工具项目", en: "AI Coding / Agents" };
  if (webHits >= 2) return { zh: "网站/网页项目", en: "Web / Coding" };
  if (devtoolHits >= 2) return { zh: "开发工具", en: "Developer Tooling" };
  if (productHits >= 2) return { zh: "产品应用", en: "Product / App" };
  return { zh: "新项目线索", en: "New Project Lead" };
}

function projectSignalText(project: NewProject): string {
  return normalizeText(
    `${project.fullName} ${project.description} ${project.language} ${project.topics.join(" ")} ${project.matchedQueries.join(
      " ",
    )} ${project.matchedCategories.join(" ")}`,
  );
}

function matchedQueryLabels(project: NewProject, labels: string[]): string[] {
  const wanted = new Set(labels.map(normalizeText));
  return project.matchedQueries.filter((label) => wanted.has(normalizeText(label)));
}

function starVelocityScore(project: NewProject, now: Date): number {
  const ageDays = Math.max(0.25, hoursSince(project.createdAt, now) / 24);
  const starsPerDay = project.stars / ageDays;
  return Math.min(34, Math.log2(starsPerDay + 1) * 10);
}

function projectTrendLabels(project: NewProject): { zh: string[]; en: string[] } {
  const text = projectSignalText(project);
  const matched = TREND_PATTERNS.filter((pattern) =>
    pattern.words.some((word) => text.includes(normalizeText(word))),
  );
  return {
    zh: matched.map((pattern) => pattern.zh),
    en: matched.map((pattern) => pattern.en),
  };
}

function scoreAiPotential(project: NewProject, now: Date): { score: number; zh: string[]; en: string[] } {
  const text = projectSignalText(project);
  const frontierHits = keywordHits(text, FRONTIER_AI_WORDS);
  const aiQueries = matchedQueryLabels(project, ["Coding Agents", "Code Generation", "MCP", "LLM Apps"]);
  const createdHours = hoursSince(project.createdAt, now);
  const pushedHours = hoursSince(project.pushedAt, now);
  const velocity = starVelocityScore(project, now);

  const frontierScore = Math.min(38, frontierHits.length * 6);
  const queryScore = aiQueries.length ? 22 + Math.min(10, (aiQueries.length - 1) * 5) : 0;
  const starScore = Math.log2(project.stars + 1) * 8;
  const forkScore = Math.log2(project.forks + 1) * 4;
  const freshScore = createdHours <= 24 ? 12 : createdHours <= 72 ? 8 : 3;
  const activityScore = pushedHours <= 24 ? 8 : pushedHours <= 72 ? 5 : 2;
  const demoScore = project.homepage ? 4 : 0;
  const topicScore = Math.min(10, project.topics.length);
  const categoryScore = project.categoryZh === "AI 工具项目" ? 8 : 0;
  const nonAiPenalty = frontierHits.length === 0 && aiQueries.length === 0 ? 16 : 0;

  const score = Math.max(
    0,
    Math.round(
      velocity +
        frontierScore +
        queryScore +
        starScore +
        forkScore +
        freshScore +
        activityScore +
        demoScore +
        topicScore +
        categoryScore -
        nonAiPenalty,
    ),
  );

  const queryPreview = queryListZh(aiQueries.slice(0, 3));
  const hitPreview = labelListZh(frontierHits.slice(0, 5));
  const ageDays = Math.max(0.25, hoursSince(project.createdAt, now) / 24);
  const starsPerDay = project.stars / ageDays;
  const zh = [
    hitPreview ? `可能值得看: ${hitPreview}` : "",
    queryPreview ? `大致方向: ${queryPreview}` : "",
    `最近关注增长: 平均每天约 ${starsPerDay.toFixed(starsPerDay >= 10 ? 0 : 1)} 人收藏`,
    project.homepage ? "有官网或演示，点开更容易看懂" : "",
    pushedHours <= 24 ? "最近还在更新" : "",
  ].filter(Boolean);
  const en = [
    hitPreview ? `Frontier signals: ${hitPreview}` : "",
    queryPreview ? `Matched AI queries: ${queryPreview}` : "",
    `Velocity: about ${starsPerDay.toFixed(starsPerDay >= 10 ? 0 : 1)} stars/day`,
    project.homepage ? "Has homepage or online demo" : "",
    pushedHours <= 24 ? "Still active in the last 24h" : "",
  ].filter(Boolean);

  return { score, zh, en };
}

function scoreWebTrend(project: NewProject, now: Date): { score: number; zh: string[]; en: string[] } {
  const text = projectSignalText(project);
  const webHits = keywordHits(text, WEB_CODING_PRODUCT_WORDS);
  const productHits = keywordHits(text, PRODUCT_WORDS);
  const webQueries = matchedQueryLabels(project, [
    "Web",
    "Frontend",
    "React",
    "Next.js",
    "Vite",
    "TypeScript Web Apps",
    "Mobile Apps",
    "iOS Apps",
    "Android Apps",
    "Flutter Apps",
    "React Native Apps",
    "Expo Apps",
    "Swift Apps",
    "Kotlin Apps",
    "Product Apps",
    "Developer Tools",
    "CLI Tools",
  ]);
  const trends = projectTrendLabels(project);
  const createdHours = hoursSince(project.createdAt, now);
  const pushedHours = hoursSince(project.pushedAt, now);
  const velocity = starVelocityScore(project, now);

  const webSignalScore = Math.min(34, webHits.length * 4);
  const productScore = Math.min(22, productHits.length * 5);
  const queryScore = webQueries.length ? 16 + Math.min(12, (webQueries.length - 1) * 4) : 0;
  const starScore = Math.log2(project.stars + 1) * 7;
  const forkScore = Math.log2(project.forks + 1) * 3;
  const demoScore = project.homepage ? 12 : 0;
  const languageScore = ["typescript", "javascript", "tsx", "jsx"].includes(normalizeText(project.language))
    ? 7
    : 0;
  const descriptionScore = project.description.length >= 60 ? 5 : project.description.length >= 24 ? 3 : 0;
  const freshnessScore = createdHours <= 24 ? 8 : createdHours <= 72 ? 5 : 2;
  const activityScore = pushedHours <= 24 ? 7 : pushedHours <= 72 ? 4 : 1;
  const trendScore = Math.min(14, trends.zh.length * 4);

  const score = Math.round(
    velocity +
      webSignalScore +
      productScore +
      queryScore +
      starScore +
      forkScore +
      demoScore +
      languageScore +
      descriptionScore +
      freshnessScore +
      activityScore +
      trendScore,
  );

  const queryPreview = queryListZh(webQueries.slice(0, 3));
  const trendPreviewZh = trends.zh.slice(0, 3).join(", ");
  const trendPreviewEn = trends.en.slice(0, 3).join(", ");
  const hitPreview = labelListZh(unique([...webHits, ...productHits]).slice(0, 5));
  const zh = [
    trendPreviewZh ? `它代表的趋势: ${trendPreviewZh}` : "",
    queryPreview ? `大致方向: ${queryPreview}` : "",
    hitPreview ? `可能是: ${hitPreview}` : "",
    project.homepage ? "有官网或演示，点开能直接看" : "",
    project.language ? `主要技术: ${project.language}` : "",
  ].filter(Boolean);
  const en = [
    trendPreviewEn ? `User/product trend: ${trendPreviewEn}` : "",
    queryPreview ? `Matched Web/Coding queries: ${queryPreview}` : "",
    hitPreview ? `Product signals: ${hitPreview}` : "",
    project.homepage ? "Has accessible homepage or demo" : "",
    project.language ? `Main stack: ${project.language}` : "",
  ].filter(Boolean);

  return { score, zh, en };
}

export function scoreProject(project: NewProject, config: NewProjectsConfig, now = new Date()): NewProject {
  const queryWeight = new Map(config.queries.map((query) => [query.label, query.weight ?? 8]));
  const text = projectSignalText(project);
  const signalHits = unique([
    ...keywordHits(text, WEB_WORDS),
    ...keywordHits(text, AI_CODING_WORDS),
    ...keywordHits(text, DEVTOOL_WORDS),
    ...keywordHits(text, PRODUCT_WORDS),
  ]);

  const createdHours = hoursSince(project.createdAt, now);
  const pushedHours = hoursSince(project.pushedAt, now);
  const matchedWeight = project.matchedQueries.reduce((sum, label) => sum + (queryWeight.get(label) ?? 8), 0);

  const starScore = Math.log2(project.stars + 1) * 16;
  const forkScore = Math.log2(project.forks + 1) * 5;
  const freshScore = createdHours <= 24 ? 14 : createdHours <= 72 ? 9 : 5;
  const activityScore = pushedHours <= 24 ? 8 : pushedHours <= 72 ? 5 : 2;
  const topicScore = Math.min(14, project.topics.length * 2);
  const keywordScore = Math.min(20, signalHits.length * 3);
  const homepageScore = project.homepage ? 5 : 0;
  const descriptionScore = project.description.length >= 50 ? 4 : project.description.length >= 20 ? 2 : 0;
  const multiQueryScore = Math.min(12, Math.max(0, project.matchedQueries.length - 1) * 4);

  const score = Math.round(
    starScore +
      forkScore +
      freshScore +
      activityScore +
      topicScore +
      keywordScore +
      homepageScore +
      descriptionScore +
      multiQueryScore +
      matchedWeight,
  );

  const category = classifyProject(project);
  const trends = projectTrendLabels({ ...project, categoryZh: category.zh, categoryEn: category.en });
  const scoredBase = { ...project, categoryZh: category.zh, categoryEn: category.en };
  const aiPotential = scoreAiPotential(scoredBase, now);
  const webTrend = scoreWebTrend(scoredBase, now);
  const topSignals = signalHits.slice(0, 5);
  const queryPreview = queryListZh(project.matchedQueries.slice(0, 3));
  const topicsPreview = project.topics.filter(hasCjk).slice(0, 5).join(", ");
  const topSignalsPreview = labelListZh(topSignals);

  const reasonsZh = [
    `项目出现于 ${ageZh(project.createdAt, now)}，最近更新 ${ageZh(project.pushedAt, now)}`,
    `${project.stars} 人收藏 / ${project.forks} 次被别人复制改造`,
    queryPreview ? `大致归类: ${queryPreview}` : "",
    project.homepage ? "有官网或演示，点开能直接看" : "",
    topicsPreview ? `项目标签: ${topicsPreview}` : "",
    topSignalsPreview ? `看点: ${topSignalsPreview}` : "",
  ].filter(Boolean);

  const reasonsEn = [
    `Created ${ageEn(project.createdAt, now)}, pushed ${ageEn(project.pushedAt, now)}`,
    `${project.stars} stars / ${project.forks} forks`,
    queryPreview ? `Matched ${queryPreview}` : "",
    project.homepage ? "Has homepage or online demo" : "",
    topicsPreview ? `Topics: ${topicsPreview}` : "",
    topSignals.length ? `Signals: ${topSignals.join(", ")}` : "",
  ].filter(Boolean);

  return {
    ...project,
    categoryZh: category.zh,
    categoryEn: category.en,
    score,
    aiPotentialScore: aiPotential.score,
    webTrendScore: webTrend.score,
    reasonsZh,
    reasonsEn,
    frontierReasonsZh: aiPotential.zh,
    frontierReasonsEn: aiPotential.en,
    webTrendReasonsZh: webTrend.zh,
    webTrendReasonsEn: webTrend.en,
    trendLabelsZh: trends.zh,
    trendLabelsEn: trends.en,
  };
}

export function rankProjects(
  projects: NewProject[],
  config: NewProjectsConfig,
  now = new Date(),
): NewProject[] {
  const ranked = projects
    .map((project) => scoreProject(project, config, now))
    .sort((a, b) => {
      const aBest = Math.max(a.aiPotentialScore, a.webTrendScore);
      const bBest = Math.max(b.aiPotentialScore, b.webTrendScore);
      return bBest - aBest || b.stars - a.stars || a.fullName.localeCompare(b.fullName);
    });
  return dedupeSimilarProjects(ranked);
}

function repoBaseName(fullName: string): string {
  const repoName = fullName.split("/")[1] ?? fullName;
  return normalizeText(repoName).replace(/-\d{2,}$/g, "");
}

function descriptionKey(project: NewProject): string {
  const description = normalizeText(project.description);
  return description.length >= 40 ? description : "";
}

function topicKey(project: NewProject): string {
  return project.topics.slice().sort().join(",");
}

function dedupeSimilarProjects(projects: NewProject[]): NewProject[] {
  const seenDescriptions = new Set<string>();
  const seenRepoFamilies = new Set<string>();
  const kept: NewProject[] = [];

  for (const project of projects) {
    const desc = descriptionKey(project);
    const family = `${repoBaseName(project.fullName)}::${desc || topicKey(project)}`;

    if (desc && seenDescriptions.has(desc)) continue;
    if (seenRepoFamilies.has(family)) continue;

    kept.push(project);
    if (desc) seenDescriptions.add(desc);
    seenRepoFamilies.add(family);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeTable(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function truncate(value: string, max = 140): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}...` : singleLine;
}

function categorySummary(projects: NewProject[], lang: "zh" | "en"): string {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const key = lang === "zh" ? project.categoryZh : project.categoryEn;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
}

function querySummary(queries: NewProjectQuery[]): string {
  return queries.map((query) => queryLabelZh(query.label)).join(", ");
}

function projectLink(project: NewProject): string {
  return `[${project.fullName}](${project.url})`;
}

function renderTable(projects: NewProject[], lang: "zh" | "en"): string {
  const header =
    lang === "zh"
      ? "| # | 项目 | 类型 | AI 潜力 | 产品看点 | 收藏 | 主要技术 | 为什么值得看 |\n|---:|---|---|---:|---:|---:|---|---|"
      : "| # | Project | Category | AI Potential | Web Trend | Stars | Language | Key Signals |\n|---:|---|---|---:|---:|---:|---|---|";

  const rows = projects.map((project, index) => {
    const category = lang === "zh" ? project.categoryZh : project.categoryEn;
    const reasons = lang === "zh" ? project.reasonsZh : project.reasonsEn;
    return [
      index + 1,
      projectLink(project),
      category,
      project.aiPotentialScore,
      project.webTrendScore,
      project.stars,
      project.language || "-",
      truncate(reasons.slice(0, 2).join("; "), 130),
    ]
      .map(escapeTable)
      .join(" | ");
  });

  return [header, ...rows.map((row) => `| ${row} |`)].join("\n");
}

function renderDetails(projects: NewProject[], lang: "zh" | "en"): string {
  return projects
    .map((project, index) => {
      const category = lang === "zh" ? project.categoryZh : project.categoryEn;
      const reasons = lang === "zh" ? project.reasonsZh : project.reasonsEn;
      const desc = lang === "zh" ? displayDescriptionZh(project) : project.description || "No description";
      const homepageLine = project.homepage
        ? lang === "zh"
          ? `- 官网或演示: ${project.homepage}`
          : `- Homepage/Demo: ${project.homepage}`
        : "";
      const licenseLine = project.license
        ? lang === "zh"
          ? `- 开源协议: ${project.license}`
          : `- License: ${project.license}`
        : "";
      const chineseTopics = project.topics.filter(hasCjk);
      const topicLine = chineseTopics.length
        ? lang === "zh"
          ? `- 项目标签: ${chineseTopics.join(", ")}`
          : `- Topics: ${project.topics.join(", ")}`
        : "";
      const queryLine =
        lang === "zh"
          ? `- 为什么被找到: ${queryListZh(project.matchedQueries)}`
          : `- Matched queries: ${project.matchedQueries.join(", ")}`;
      const trendLine =
        lang === "zh"
          ? project.trendLabelsZh.length
            ? `- 项目方向: ${project.trendLabelsZh.join(", ")}`
            : ""
          : project.trendLabelsEn.length
            ? `- Trend labels: ${project.trendLabelsEn.join(", ")}`
            : "";
      const frontierReasonLines = (lang === "zh" ? project.frontierReasonsZh : project.frontierReasonsEn)
        .map((reason) => `  - ${reason}`)
        .join("\n");
      const webTrendReasonLines = (lang === "zh" ? project.webTrendReasonsZh : project.webTrendReasonsEn)
        .map((reason) => `  - ${reason}`)
        .join("\n");
      const reasonLines = reasons.map((reason) => `  - ${reason}`).join("\n");
      const reasonHeader = lang === "zh" ? "为什么值得看:" : "Why it is worth a look:";

      return [
        `<details>`,
        `<summary><strong>${index + 1}. ${project.fullName}</strong> · ${category} · AI 潜力 ${project.aiPotentialScore} / 产品看点 ${project.webTrendScore}</summary>`,
        ``,
        `- 项目地址: ${project.url}`,
        homepageLine,
        licenseLine,
        topicLine,
        `- ${lang === "zh" ? "主要技术" : "Language"}: ${project.language || "-"}`,
        `- ${lang === "zh" ? "创建" : "Created"}: ${project.createdAt}`,
        `- ${lang === "zh" ? "最近更新" : "Last push"}: ${project.pushedAt}`,
        `- ${lang === "zh" ? "描述" : "Description"}: ${desc}`,
        queryLine,
        trendLine,
        `- ${lang === "zh" ? "AI 潜力" : "AI potential score"}: ${project.aiPotentialScore}`,
        `- ${lang === "zh" ? "产品看点" : "Web trend score"}: ${project.webTrendScore}`,
        ``,
        lang === "zh" ? `为什么值得先看:` : `AI potential rationale:`,
        frontierReasonLines ||
          `  - ${lang === "zh" ? "暂时没有明显的 AI 热点信号" : "No strong AI frontier signal"}`,
        ``,
        lang === "zh" ? `产品看点:` : `Web Coding trend rationale:`,
        webTrendReasonLines ||
          `  - ${lang === "zh" ? "暂时没有明显的产品看点" : "No strong Web Coding product signal"}`,
        ``,
        `${reasonHeader}`,
        reasonLines,
        ``,
        `</details>`,
      ]
        .filter((line) => line !== "")
        .join("\n");
    })
    .join("\n\n");
}

function topBy(
  projects: NewProject[],
  key: "aiPotentialScore" | "webTrendScore",
  limit: number,
): NewProject[] {
  return [...projects]
    .filter((project) => project[key] > 0)
    .sort((a, b) => b[key] - a[key] || b.stars - a.stars || a.fullName.localeCompare(b.fullName))
    .slice(0, limit);
}

function topMobileProjects(projects: NewProject[], limit: number): NewProject[] {
  return [...projects]
    .filter(hasMobileAppSignal)
    .sort(
      (a, b) =>
        b.webTrendScore - a.webTrendScore || b.stars - a.stars || a.fullName.localeCompare(b.fullName),
    )
    .slice(0, limit);
}

function selectDigestProjects(projects: NewProject[], limit: number): NewProject[] {
  const selected = new Map<string, NewProject>();
  const add = (items: NewProject[]) => {
    for (const project of items) {
      if (selected.size >= limit) return;
      selected.set(project.fullName, project);
    }
  };

  add(projects.slice(0, Math.ceil(limit * 0.35)));
  add(topBy(projects, "aiPotentialScore", Math.ceil(limit * 0.3)));
  add(topBy(projects, "webTrendScore", Math.ceil(limit * 0.35)));
  add(topMobileProjects(projects, Math.ceil(limit * 0.35)));
  add(projects);

  return [...selected.values()]
    .sort((a, b) => {
      const aBest = Math.max(a.aiPotentialScore, a.webTrendScore);
      const bBest = Math.max(b.aiPotentialScore, b.webTrendScore);
      return bBest - aBest || b.stars - a.stars || a.fullName.localeCompare(b.fullName);
    })
    .slice(0, limit);
}

function renderLeaderboard(
  projects: NewProject[],
  key: "aiPotentialScore" | "webTrendScore",
  reasonKey: "frontierReasonsZh" | "frontierReasonsEn" | "webTrendReasonsZh" | "webTrendReasonsEn",
  lang: "zh" | "en",
): string {
  return projects
    .map((project, index) => {
      const category = lang === "zh" ? project.categoryZh : project.categoryEn;
      const reasons = project[reasonKey];
      const desc = truncate(
        lang === "zh" ? displayDescriptionZh(project) : project.description || "No description",
        120,
      );
      const scoreName = key === "aiPotentialScore" ? "AI 潜力" : "产品看点";
      return `${index + 1}. ${projectLink(project)} · ${category} · ${scoreName} ${project[key]}\n   ${desc}\n   ${reasons.slice(0, 3).join("; ")}`;
    })
    .join("\n\n");
}

function buildTrendInsights(projects: NewProject[], lang: "zh" | "en"): string {
  const labelCounts = new Map<string, { count: number; examples: NewProject[] }>();
  for (const project of projects) {
    const labels = lang === "zh" ? project.trendLabelsZh : project.trendLabelsEn;
    for (const label of labels) {
      const entry = labelCounts.get(label) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push(project);
      labelCounts.set(label, entry);
    }
  }

  const rows = [...labelCounts.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  if (!rows.length) {
    return lang === "zh"
      ? "这次样本里还没有形成足够清晰的产品行为聚类。"
      : "This sample does not yet form a clear Web Coding behavior cluster.";
  }

  return rows
    .slice(0, 6)
    .map(([label, entry]) => {
      const examples = entry.examples.map((project) => projectLink(project)).join(", ");
      return lang === "zh"
        ? `- **${label}**: ${entry.count} 个项目，例子: ${examples}`
        : `- **${label}**: ${entry.count} projects, examples: ${examples}`;
    })
    .join("\n");
}

export function buildNewProjectsMarkdown(
  projects: NewProject[],
  meta: DigestMeta,
  lang: "zh" | "en",
): string {
  const aiFrontier = topBy(projects, "aiPotentialScore", 10);
  const webTrends = topBy(projects, "webTrendScore", 10);
  const mobileApps = topMobileProjects(projects, 15);
  const title =
    lang === "zh" ? `# 新项目发现榜 ${meta.dateStr}` : `# GitHub New Projects Radar ${meta.dateStr}`;
  const sourceLine =
    lang === "zh"
      ? `> 我从最近 ${meta.lookbackDays} 天新出现的 GitHub 项目里做了一次筛选（从 ${meta.sinceDate} 开始）。这次先找到 ${meta.totalUnique} 个备选项目，最后挑出最值得看的项目。生成时间: ${meta.utcStr} UTC`
      : `> Source: GitHub Search API | Window: last ${meta.lookbackDays} days (since ${meta.sinceDate}) | Raw results: ${meta.totalRaw} | Unique repos: ${meta.totalUnique} | Generated: ${meta.utcStr} UTC`;
  const queryLine =
    lang === "zh"
      ? `> 监控方向: ${querySummary(meta.activeQueries)}`
      : `> Search tracks: ${querySummary(meta.activeQueries)}`;
  const categoryLine =
    lang === "zh"
      ? `> 分类分布: ${categorySummary(projects, "zh") || "暂无"}`
      : `> Category mix: ${categorySummary(projects, "en") || "None"}`;

  if (projects.length === 0) {
    return [
      title,
      "",
      sourceLine,
      queryLine,
      "",
      "---",
      "",
      lang === "zh" ? "这次没有发现符合条件的新项目。" : "No matching new projects were found this run.",
    ].join("\n");
  }

  return [
    title,
    "",
    sourceLine,
    queryLine,
    categoryLine,
    "",
    "---",
    "",
    lang === "zh" ? "## AI 可能会火" : "## AI Frontier Potential",
    "",
    renderLeaderboard(
      aiFrontier,
      "aiPotentialScore",
      lang === "zh" ? "frontierReasonsZh" : "frontierReasonsEn",
      lang,
    ),
    "",
    "---",
    "",
    lang === "zh" ? "## 大家在做的产品" : "## Web Coding Product & Behavior Trends",
    "",
    renderLeaderboard(
      webTrends,
      "webTrendScore",
      lang === "zh" ? "webTrendReasonsZh" : "webTrendReasonsEn",
      lang,
    ),
    "",
    "---",
    "",
    lang === "zh" ? "## 手机/App 项目" : "## Mobile / App Products",
    "",
    renderLeaderboard(
      mobileApps,
      "webTrendScore",
      lang === "zh" ? "webTrendReasonsZh" : "webTrendReasonsEn",
      lang,
    ),
    "",
    "---",
    "",
    lang === "zh" ? "## 这期大家集中在做什么" : "## What Builders Are Doing",
    "",
    buildTrendInsights(projects, lang),
    "",
    "---",
    "",
    lang === "zh" ? "## 全部项目" : "## Project List",
    "",
    renderTable(projects, lang),
    "",
    "---",
    "",
    lang === "zh" ? "## 详细信息" : "## Details",
    "",
    renderDetails(projects, lang),
  ].join("\n");
}

function publicProject(project: NewProject): Record<string, unknown> {
  return {
    fullName: project.fullName,
    url: project.url,
    descriptionZh: displayDescriptionZh(project),
    language: project.language,
    stars: project.stars,
    forks: project.forks,
    openIssues: project.openIssues,
    topics: project.topics.filter(hasCjk),
    homepage: project.homepage,
    license: project.license,
    owner: project.owner,
    ownerAvatarUrl: project.ownerAvatarUrl,
    createdAt: project.createdAt,
    pushedAt: project.pushedAt,
    updatedAt: project.updatedAt,
    matchedQueries: project.matchedQueries.map(queryLabelZh),
    matchedCategories: unique(project.matchedCategories.map(categoryLabelZh)),
    categoryZh: project.categoryZh,
    score: project.score,
    aiPotentialScore: project.aiPotentialScore,
    webTrendScore: project.webTrendScore,
    reasonsZh: project.reasonsZh,
    frontierReasonsZh: project.frontierReasonsZh,
    webTrendReasonsZh: project.webTrendReasonsZh,
    trendLabelsZh: project.trendLabelsZh,
  };
}

function buildJsonDigest(projects: NewProject[], meta: DigestMeta): string {
  return (
    JSON.stringify(
      {
        version: 1,
        generatedAt: meta.generatedAt,
        date: meta.dateStr,
        since: meta.sinceDate,
        lookbackDays: meta.lookbackDays,
        source: "GitHub 搜索数据",
        rawResults: meta.totalRaw,
        uniqueRepos: meta.totalUnique,
        queryTracks: meta.activeQueries.map((query) => ({
          label: queryLabelZh(query.label),
          category: query.category ? categoryLabelZh(query.category) : queryLabelZh(query.label),
          weight: query.weight ?? 8,
        })),
        rankings: {
          aiFrontier: topBy(projects, "aiPotentialScore", 20).map((project) => project.fullName),
          productTrends: topBy(projects, "webTrendScore", 20).map((project) => project.fullName),
          mobileApps: topMobileProjects(projects, 30).map((project) => project.fullName),
        },
        trendInsights: {
          zh: buildTrendInsights(projects, "zh"),
        },
        projects: projects.map(publicProject),
      },
      null,
      2,
    ) + "\n"
  );
}

function saveDigestFiles(projects: NewProject[], meta: DigestMeta): void {
  const dir = path.join("digests", meta.dateStr);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, "new-projects.md"),
    buildNewProjectsMarkdown(projects, meta, "zh"),
    "utf-8",
  );
  fs.writeFileSync(path.join(dir, "new-projects.json"), buildJsonDigest(projects, meta), "utf-8");

  console.log(`  Saved ${path.join(dir, "new-projects.md")}`);
  console.log(`  Saved ${path.join(dir, "new-projects.json")}`);
}

async function maybeCreateIssue(
  projects: NewProject[],
  meta: DigestMeta,
  config: NewProjectsConfig,
): Promise<void> {
  const digestRepo = process.env["DIGEST_REPO"] ?? "";
  if (!config.createIssue || !digestRepo) return;

  const body = buildNewProjectsMarkdown(projects, meta, "zh");
  const title = `GitHub 新项目雷达 ${meta.dateStr}`;
  const url = await createGitHubIssue(title, body, "new-projects");
  console.log(`  Created new-projects issue: ${url}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadNewProjectsConfig();
  const now = new Date();
  const since = new Date(now.getTime() - config.lookbackDays * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);
  const dateStr = toCstDateStr(now);
  const utcStr = toUtcStr(now);

  console.log(
    `[${now.toISOString()}] Starting GitHub new-project radar | lookback=${config.lookbackDays}d, minStars=${config.minStars}, maxResults=${config.maxResults}`,
  );

  const { projects: ranked, totalRaw, activeQueries } = await collectNewProjects(config, sinceDate, now);
  const projects = selectDigestProjects(ranked, config.maxResults);

  const meta: DigestMeta = {
    dateStr,
    utcStr,
    sinceDate,
    generatedAt: now.toISOString(),
    lookbackDays: config.lookbackDays,
    totalRaw,
    totalUnique: ranked.length,
    activeQueries,
  };

  saveDigestFiles(projects, meta);
  await maybeCreateIssue(projects, meta, config);

  console.log(`Done: ${projects.length} projects selected from ${ranked.length} unique candidates.`);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("new-projects.ts") || process.argv[1].endsWith("new-projects.js"));

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
