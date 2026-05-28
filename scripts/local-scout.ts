import fs from "node:fs";
import path from "node:path";
import { fetchArxivData } from "../src/arxiv.ts";
import { fetchDevtoData } from "../src/devto.ts";
import { fetchHfData } from "../src/hf.ts";
import { fetchHnData } from "../src/hn.ts";
import { fetchLobstersData } from "../src/lobsters.ts";
import { fetchPhData } from "../src/ph.ts";
import { fetchTrendingData } from "../src/trending.ts";

type Candidate = {
  source: string;
  sourceLabel?: string;
  title: string;
  zhTitle?: string;
  url: string;
  score: number;
  category: string;
  why: string[];
  zhWhy?: string[];
  details?: string;
  zhDetails?: string;
  meta?: Record<string, unknown>;
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "scout");
const TOP_LIMIT = Number(process.env["SCOUT_LIMIT"] ?? "35");

const PRODUCT_WORDS = [
  "app",
  "tool",
  "product",
  "launch",
  "demo",
  "builder",
  "workflow",
  "automation",
  "agent",
  "assistant",
  "copilot",
  "studio",
  "canvas",
  "editor",
  "browser",
  "desktop",
  "mobile",
  "ios",
  "macos",
  "android",
  "extension",
  "open source",
  "open-source",
  "github",
  "api",
  "sdk",
  "cli",
  "mcp",
  "design",
  "image",
  "video",
  "photo",
  "comic",
  "manga",
  "story",
  "生成",
  "开源",
  "产品",
  "工具",
  "工程",
  "上线",
  "发布",
  "漫画",
  "图像",
  "视频",
];

const CREATIVE_WORDS = [
  "image",
  "video",
  "photo",
  "design",
  "comic",
  "manga",
  "story",
  "canvas",
  "creative",
  "generative",
  "swiftui",
  "ios",
  "漫画",
  "角色",
  "分镜",
  "创作",
];

const INFRA_WORDS = [
  "framework",
  "runtime",
  "database",
  "vector",
  "rag",
  "eval",
  "observability",
  "inference",
  "training",
  "benchmark",
  "agent",
  "mcp",
  "sdk",
  "cli",
];

function nowInChina(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncate(value: string | undefined, length = 260): string {
  if (!value) return "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > length ? `${singleLine.slice(0, length - 1)}...` : singleLine;
}

function keywordHits(text: string, words: string[]): string[] {
  const haystack = normalize(text);
  return words.filter((word) => haystack.includes(normalize(word)));
}

function classify(text: string): string {
  const creativeHits = keywordHits(text, CREATIVE_WORDS).length;
  const infraHits = keywordHits(text, INFRA_WORDS).length;
  if (creativeHits >= 2) return "AI 创作/多模态产品";
  if (infraHits >= 2) return "开发者工具/工程基础设施";
  if (keywordHits(text, ["show hn", "launch", "product", "app", "上线", "发布"]).length) {
    return "可试用产品";
  }
  return "值得跟进";
}

function addCandidate(candidates: Candidate[], item: Candidate): void {
  if (!item.url && !item.title) return;
  const hasSame = candidates.some((existing) => {
    if (item.url && existing.url && item.url === existing.url) return true;
    return normalize(existing.title) === normalize(item.title);
  });
  if (!hasSame) candidates.push(item);
}

function scoreKeywords(text: string): { points: number; hits: string[] } {
  const hits = keywordHits(text, PRODUCT_WORDS);
  return { points: Math.min(36, hits.length * 6), hits };
}

function compactNumber(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

const SOURCE_LABELS: Record<string, string> = {
  "GitHub Trending": "GitHub 今日趋势",
  "GitHub Search": "GitHub 主题搜索",
  "Hacker News": "Hacker News 社区",
  "Product Hunt": "Product Hunt 新品榜",
  "Hugging Face": "Hugging Face 模型榜",
  "Dev.to": "Dev.to 开发者文章",
  "Lobste.rs": "Lobste.rs 技术社区",
  ArXiv: "ArXiv 论文",
  "X/Twitter": "X/Twitter 产品线索",
};

const KEYWORD_LABELS: Record<string, string> = {
  app: "应用",
  tool: "工具",
  product: "产品",
  launch: "发布",
  launched: "已发布",
  released: "发布",
  introducing: "正式介绍",
  demo: "演示",
  builder: "构建器",
  workflow: "工作流",
  automation: "自动化",
  agent: "智能体",
  assistant: "助手",
  copilot: "编程助手",
  studio: "工作台",
  canvas: "画布",
  editor: "编辑器",
  browser: "浏览器",
  desktop: "桌面端",
  mobile: "移动端",
  ios: "iOS",
  macos: "macOS",
  android: "Android",
  extension: "扩展",
  "open source": "开源",
  "open-source": "开源",
  "open-sourced": "已开源",
  github: "GitHub",
  api: "API",
  sdk: "SDK",
  cli: "命令行工具",
  mcp: "MCP",
  design: "设计",
  image: "图像",
  video: "视频",
  photo: "照片",
  comic: "漫画",
  manga: "日漫",
  story: "故事",
  "i made": "作者自己做了",
  "i built": "作者自己搭了",
  "we built": "团队做了",
  "made an app": "做了一个应用",
  "built an app": "搭了一个应用",
  "new app": "新应用",
  "new tool": "新工具",
  "vector-db": "向量数据库",
  rag: "RAG",
  "ai-agent": "AI 智能体",
  llm: "大模型",
  "llm-model": "大模型",
  ml: "机器学习",
  "image-text-to-text": "图像/文本到文本",
  "any-to-any": "任意模态互转",
};

type Translation = {
  title?: string;
  details?: string;
};

const CURATED_TRANSLATIONS: Record<string, Translation> = {
  "https://github.com/harry0703/MoneyPrinterTurbo": {
    title: "MoneyPrinterTurbo：一键生成高清短视频",
    details: "用 AI 大模型自动生成短视频，从文案、素材到成片尽量一条龙完成。",
  },
  "https://x.com/jackfriks/status/2058977146266366151": {
    title: "@jackfriks：做了一个逼你 30 天内公开发布产品的 App",
    details:
      "这个 App 的核心是反拖延：30 天内不把自己的产品公开发布，就会用很强的公开压力逼你行动。作者吐槽很多人只是在谈“AI 工作流提升 100 倍”，但实际发布、收入和用户都还是 0。",
  },
  "https://github.com/langchain4j/langchain4j": {
    title: "langchain4j：给 Java/JVM 用的 LLM 应用开发库",
    details:
      "一个面向 JVM 的开源库，统一封装主流大模型、向量库、工具调用、MCP、智能体和 RAG，适合 Java 技术栈做 AI 应用。",
  },
  "https://github.com/Lum1104/Understand-Anything": {
    title: "Understand Anything：把代码库变成可提问的知识图谱",
    details:
      "它主张“能教人的图谱比炫技图谱更有用”：把任意代码转成交互式知识图谱，可以探索、搜索、提问，并能配合 Claude Code、Codex、Cursor、Copilot、Gemini CLI 等工具使用。",
  },
  "https://github.com/safishamsi/graphify": {
    title: "graphify：把代码、文档、图片和视频转成可查询知识图谱",
    details:
      "一个 AI 编码助手技能，可以把文件夹里的代码、数据库结构、脚本、文档、论文、图片和视频整理成可提问的知识图谱，适合理解复杂项目。",
  },
  "https://github.com/iOfficeAI/AionUi": {
    title: "AionUi：本地开源的 24 小时 AI 协作工作台",
    details:
      "一个本地、免费、开源的 AI 工作台，面向 OpenClaw、Hermes Agent、Claude Code、Codex、OpenCode、Gemini CLI 等 20 多种命令行助手，可以定制自己的助手组合。",
  },
  "https://x.com/jackfriks/status/2058979566278910409": {
    title: "@jackfriks：把从 0 到月入 4 万美元的路径做成 App",
    details:
      "作者说这个 App 像一张行动路线图，想把更多人带到他三年前走上的那条路：从不会写代码、不会做可收费产品，到靠公开发布和持续迭代跑出收入。",
  },
  "https://github.com/affaan-m/ECC": {
    title: "ECC：面向 AI 编码智能体的性能优化框架",
    details:
      "一个给 Claude Code、Codex、OpenCode、Cursor 等智能体使用的优化系统，强调技能、直觉、记忆、安全和研究优先的软件开发流程。",
  },
  "https://github.com/twentyhq/twenty": {
    title: "Twenty：面向 AI 时代的开源 Salesforce 替代品",
    details: "一个开源 CRM，定位是 Salesforce 的开源替代方案，并且从设计上面向 AI 工作流。",
  },
  "https://github.com/microsoft/markitdown": {
    title: "MarkItDown：把 Office 等文件转成 Markdown 的工具",
    details: "微软出的 Python 工具，可以把文档、表格、演示文稿等文件转换成 Markdown，方便进入 AI/知识库流程。",
  },
  "https://github.com/obra/superpowers": {
    title: "superpowers：智能体技能框架和软件开发方法论",
    details: "一个面向智能体的技能框架，也是一套软件开发方法论，目标是让 AI 助手更稳定地参与真实工程。",
  },
  "https://github.com/anthropics/skills": {
    title: "Anthropic Skills：Claude/智能体技能公开仓库",
    details: "Anthropic 公开的 Agent Skills 仓库，可以理解成给智能体安装能力包的参考集合。",
  },
  "https://huggingface.co/Jackrong/Qwopus3.6-27B-v2-GGUF": {
    title: "Qwopus3.6-27B-v2-GGUF：支持视觉的本地量化模型",
    details:
      "GGUF/llama.cpp 方向的多模态模型，支持图像理解、对话和文本生成，适合关注本地运行、多模态推理的人跟进。",
  },
  "https://huggingface.co/Jackrong/Qwopus3.6-27B-v2-MTP-GGUF": {
    title: "Qwopus3.6-27B-v2-MTP-GGUF：多模态本地模型变体",
    details:
      "Qwopus3.6 27B 的另一个 GGUF 变体，下载量更高，同样偏本地多模态、图像到文本和对话能力。",
  },
  "https://x.com/jackfriks/status/2059093819790881231": {
    title: "@jackfriks：和当年改变自己的产品作者一起发布新 App",
    details:
      "作者说三年前买过对方的产品，并因此改变了自己的路径；现在两个人一起发布一个新 App。这条更像创作者产品发布背后的故事线索。",
  },
  "https://x.com/godofprompt/status/2059548217285713933": {
    title: "@godofprompt：Perplexity 开源安全扫描器 Bumblebee",
    details:
      "Perplexity 开源了内部安全扫描器 Bumblebee。它会只读扫描本机是否有被污染的包、恶意浏览器扩展、受感染的 VS Code/Cursor/Windsurf 扩展，以及 MCP 服务配置风险。",
  },
  "https://x.com/egeberkina/status/2058975894002356566": {
    title: "@egeberkina：发现一个把导演、剪辑和 AI 模型合在一起的视频工具",
    details:
      "作者认为现在 AI 视频工作流仍然很碎片化，但 Flova 这类产品把导演、剪辑、动态设计和 AI 模型放进同一个工作区，让不会 AI 的人也能做视频。",
  },
  "https://x.com/_adishj/status/2059303495061352780": {
    title: "@_adishj：Motion 推出“运动设计系统”",
    details:
      "Motion Design Systems 的思路是用一个 Markdown 文件记住品牌的 Logo、字体、颜色和视觉规范，以后生成视频时保持一致风格。",
  },
  "https://github.com/CherryHQ/cherry-studio": {
    title: "Cherry Studio：整合大模型、智能体和助手的效率工作台",
    details: "一个 AI 效率工作台，包含智能聊天、自主智能体、300 多个助手，并统一接入多家前沿大模型。",
  },
  "https://github.com/zhayujie/CowAgent": {
    title: "CowAgent：开源超级 AI 助手和智能体底座",
    details:
      "一个开源 AI 助手/智能体框架，可以规划任务、调用工具和技能，并通过记忆和知识自我扩展；支持多模型、多渠道，轻量可扩展，前身是 chatgpt-on-wechat。",
  },
  "https://github.com/HKUDS/nanobot": {
    title: "NanoBot：轻量开源 AI 智能体",
    details: "一个轻量级开源智能体，可以接入你的工具、聊天和工作流。",
  },
  "https://github.com/activepieces/activepieces": {
    title: "Activepieces：AI 智能体和 MCP 工作流自动化平台",
    details:
      "一个自动化平台，围绕 AI 智能体、MCP 服务和工作流搭建，官方描述里强调约 400 个 MCP server 可供智能体使用。",
  },
  "https://x.com/EXM7777/status/2058609483790836095": {
    title: "@EXM7777：把 Obsidian 当作 AI 工具记忆层",
    details:
      "作者提出一个很实用的用法：每天在 X 上看到新的智能体框架、CLI、MCP、API 时，不只是收藏，而是把它们沉淀到 Obsidian，变成以后可检索、可复用的工具记忆层。",
  },
  "https://x.com/AmirMushich/status/2059321893732163616": {
    title: "@AmirMushich：开源 Figma 转视频工具 VibeMotion-1",
    details:
      "他们开源了 VibeMotion-1 的预览版：可以导入 Figma 画框和图层，用提示词驱动图层动画，并结合本地 LTX-2.3 模型做图像动画和视频编辑。",
  },
  "https://x.com/jackfriks/status/2059309243124068763": {
    title: "@jackfriks：用 1 小时、3 美元做出发布视频并带来收入",
    details:
      "作者复盘 ShipOrDie 发布视频：不用花几天和上千美元，自己用代码和 AI 在 1 小时内做出发布视频，产品上线 22 小时收入超过 2.6 万美元。",
  },
  "https://github.com/Leonxlnx/taste-skill": {
    title: "Taste-Skill：给 AI 加一点“审美”的技能",
    details: "一个让 AI 少生成无聊、套路化内容的技能文件，目标是提升输出品味。",
  },
  "https://github.com/hardikpandya/stop-slop": {
    title: "stop-slop：去掉 AI 写作味的技能文件",
    details: "一个专门清理 AI 写作痕迹的 skill 文件，让文本少一点模板感和机器味。",
  },
  "https://github.com/DigitalPlatDev/FreeDomain": {
    title: "FreeDomain：免费域名项目",
    details: "DigitalPlat 的免费域名项目，目标是让每个人都能拿到可用域名。",
  },
  "https://github.com/byoungd/English-level-up-tips": {
    title: "English-level-up-tips：进阶英语学习指南",
    details: "一个偏系统化、进阶向的英语学习指南，里面也有中文说明。",
  },
  "https://github.com/codecrafters-io/build-your-own-x": {
    title: "build-your-own-x：通过复刻经典技术来学编程",
    details: "一个很经典的学习型仓库：通过从零复刻数据库、编译器、Docker、Git 等技术来掌握编程。",
  },
  "https://x.com/jackfriks/status/2058950253735194840": {
    title: "@jackfriks：今天发布新 App",
    details: "作者说今天发布一个新 App，未婚妻和妈妈都觉得很酷，希望全世界其他人也同意。",
  },
  "https://simonwillison.net/2026/May/27/product-market-fit/": {
    title: "Simon Willison：Anthropic 和 OpenAI 可能已经找到产品市场匹配",
    details:
      "一篇关于 Anthropic 和 OpenAI 产品市场匹配的讨论，在 Hacker News 上有很高热度，适合作为判断 AI 产品方向的背景材料。",
  },
  "https://x.com/levelsio/status/2058963383378944303": {
    title: "@levelsio：关于视频搬运和收益分配的产品机制想法",
    details:
      "他认为与其封禁或取消变现，不如像 YouTube 一样把搬运内容的收入自动转给原作者：转载带来更多曝光，版权方也能拿到钱。",
  },
  "https://huggingface.co/bytedance-research/Lance": {
    title: "Lance：字节研究的任意模态互转多模态模型",
    details:
      "一个面向图像生成、视频生成、图像编辑和视频理解的多模态模型，底座来自 Qwen2.5-VL-3B-Instruct。",
  },
  "https://github.com/langgenius/dify": {
    title: "Dify：可生产使用的智能体工作流平台",
    details: "一个生产级平台，用来开发智能体工作流和 LLM 应用，适合做产品化 AI 应用底座。",
  },
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function translateKeywordList(value: string): string {
  return value
    .split(",")
    .map((keyword) => {
      const trimmed = keyword.trim();
      return KEYWORD_LABELS[trimmed.toLowerCase()] ?? trimmed;
    })
    .join("、");
}

function translateSignal(value: string): string {
  if (value.startsWith("关键词：")) return `关键词：${translateKeywordList(value.slice("关键词：".length))}`;
  if (value.startsWith("命中发布/产品线索：")) {
    return `命中发布/产品线索：${translateKeywordList(value.slice("命中发布/产品线索：".length))}`;
  }
  if (value.startsWith("命中产品/工程关键词：")) {
    return `命中产品/工程关键词：${translateKeywordList(value.slice("命中产品/工程关键词：".length))}`;
  }
  if (value.startsWith("搜索命中：")) {
    return `搜索命中：${translateKeywordList(value.slice("搜索命中：".length))}`;
  }
  if (value.startsWith("任务：")) return `任务：${translateKeywordList(value.slice("任务：".length))}`;
  if (value === "GitHub daily trending") return "GitHub 今日趋势榜";
  if (value === "AI topic 活跃仓库") return "AI 主题下近期活跃的仓库";
  if (value === "HF 近期高赞模型") return "Hugging Face 近期高赞模型";
  return value
    .replace(/stars/g, "个星标")
    .replace(/likes/g, "个赞")
    .replace(/bookmarks/g, "次收藏")
    .replace(/downloads/g, "次下载")
    .replace(/votes/g, "票")
    .replace(/comments/g, "条评论")
    .replace(/reactions/g, "个反应")
    .replace(/min read/g, "分钟阅读")
    .replace(/points/g, "分")
    .replace(/Show HN/g, "Show HN")
    .replace(/HN 社区讨论热度/g, "Hacker News 社区讨论热度");
}

function localizeCandidate(item: Candidate): Candidate {
  const translation = CURATED_TRANSLATIONS[item.url] ?? CURATED_TRANSLATIONS[item.title];
  return {
    ...item,
    sourceLabel: sourceLabel(item.source),
    zhTitle: translation?.title ?? item.title,
    zhDetails: translation?.details ?? item.details,
    zhWhy: item.why.map(translateSignal),
  };
}

function displaySource(item: Candidate): string {
  return item.sourceLabel ?? sourceLabel(item.source);
}

function displayTitle(item: Candidate): string {
  return item.zhTitle ?? item.title;
}

function displayDetails(item: Candidate): string {
  return item.zhDetails ?? item.details ?? "";
}

function displayWhy(item: Candidate): string[] {
  return item.zhWhy ?? item.why.map(translateSignal);
}

function findNewestXSource(): string | null {
  const outputDir = path.resolve(ROOT, "..", "ai-x-digest", "output");
  if (!fs.existsSync(outputDir)) return null;
  const files = fs
    .readdirSync(outputDir)
    .filter((name) => /^model_source_.*full_noreplies\.json$/.test(name) || /^weekly_source_.*full_noreplies\.json$/.test(name))
    .map((name) => path.join(outputDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

function numberMetric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replace(/[^\d.]/g, "")) || 0;
  return 0;
}

function loadXCandidates(): Candidate[] {
  const file = findNewestXSource();
  if (!file) return [];

  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    date?: string;
    source?: string;
    items?: Array<{
      handle?: string;
      display_name?: string;
      note?: string;
      kind?: string;
      text?: string;
      url?: string;
      metrics?: Record<string, unknown>;
    }>;
  };

  const candidates: Candidate[] = [];
  for (const post of raw.items ?? []) {
    const text = post.text ?? "";
    if (/^RT\s+@/i.test(text)) continue;

    const metrics = post.metrics ?? {};
    const { points, hits } = scoreKeywords(text);
    const linkBoost = /https?:\/\/|github\.com|producthunt\.com|demo|waitlist|launch/i.test(text) ? 18 : 0;
    const launchHits = keywordHits(text, [
      "github",
      "producthunt",
      "demo",
      "waitlist",
      "launch",
      "launched",
      "released",
      "introducing",
      "open-sourced",
      "i made",
      "i built",
      "we built",
      "made an app",
      "built an app",
      "new app",
      "new tool",
      "发布",
      "上线",
      "开源",
    ]);
    const likes = numberMetric(metrics["likes"]);
    const reposts = numberMetric(metrics["reposts"]);
    const bookmarks = numberMetric(metrics["bookmarks"]);
    const engagement = Math.min(42, Math.log10(likes + reposts * 3 + bookmarks * 4 + 1) * 15);
    const score = 28 + points + linkBoost + engagement;
    if (points + linkBoost < 18 || (linkBoost === 0 && launchHits.length === 0)) continue;

    const handle = post.handle ? `@${post.handle}` : "X";
    addCandidate(candidates, {
      source: "X/Twitter",
      title: `${handle}: ${truncate(text, 90)}`,
      url: post.url ?? "",
      score,
      category: classify(text),
      why: [
        launchHits.length
          ? `命中发布/产品线索：${launchHits.slice(0, 5).join(", ")}`
          : `命中产品/工程关键词：${hits.slice(0, 5).join(", ")}`,
        `互动信号：${compactNumber(likes)} likes / ${compactNumber(bookmarks)} bookmarks`,
        raw.date ? `来自 X 源 ${raw.date}` : "来自本地 X digest 输出",
      ],
      details: truncate(text),
      meta: {
        handle: post.handle,
        kind: post.kind,
        note: post.note,
        xSourceFile: path.relative(ROOT, file),
      },
    });
  }

  return candidates;
}

async function buildCandidates(): Promise<Candidate[]> {
  const [trending, hn, hf, devto, ph, lobsters, arxiv] = await Promise.all([
    fetchTrendingData(),
    fetchHnData(),
    fetchHfData(),
    fetchDevtoData(),
    fetchPhData(),
    fetchLobstersData(),
    fetchArxivData(),
  ]);

  const candidates: Candidate[] = [];

  for (const repo of trending.trendingRepos) {
    const text = `${repo.fullName} ${repo.description} ${repo.language}`;
    const { points, hits } = scoreKeywords(text);
    const novelty = repo.totalStars < 3000 && repo.todayStars >= 50 ? 18 : 0;
    addCandidate(candidates, {
      source: "GitHub Trending",
      title: repo.fullName,
      url: repo.url,
      score: 54 + Math.min(45, repo.todayStars / 8) + novelty + points,
      category: classify(text),
      why: [
        `今日新增 ${compactNumber(repo.todayStars)} stars，总计 ${compactNumber(repo.totalStars)} stars`,
        novelty ? "相对早期但当天增长快" : "GitHub daily trending",
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "社区热度明显",
      ],
      details: truncate(repo.description),
      meta: { language: repo.language, forks: repo.forks },
    });
  }

  for (const repo of trending.searchRepos) {
    const text = `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""} ${repo.searchQuery}`;
    const { points, hits } = scoreKeywords(text);
    addCandidate(candidates, {
      source: "GitHub Search",
      title: repo.fullName,
      url: repo.url,
      score: 38 + Math.min(38, Math.log10(repo.stargazersCount + 1) * 12) + points,
      category: classify(text),
      why: [
        `${compactNumber(repo.stargazersCount)} stars，近 7 天仍活跃`,
        `搜索命中：${repo.searchQuery}`,
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "AI topic 活跃仓库",
      ],
      details: truncate(repo.description ?? ""),
      meta: { language: repo.language, pushedAt: repo.pushedAt },
    });
  }

  for (const story of hn.stories) {
    const text = `${story.title} ${story.url}`;
    const { points, hits } = scoreKeywords(text);
    const showHn = /^show hn:/i.test(story.title) ? 24 : 0;
    addCandidate(candidates, {
      source: "Hacker News",
      title: story.title,
      url: story.url,
      score: 34 + Math.min(38, story.points / 4) + Math.min(20, story.comments / 3) + showHn + points,
      category: classify(text),
      why: [
        `${story.points} points / ${story.comments} comments`,
        showHn ? "Show HN 项目，通常可直接试用" : "HN 社区讨论热度",
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "高讨论信号",
      ],
      meta: { hnUrl: story.hnUrl, author: story.author, createdAt: story.createdAt },
    });
  }

  for (const product of ph.products) {
    const text = `${product.name} ${product.tagline} ${product.topics.join(" ")}`;
    const { points, hits } = scoreKeywords(text);
    addCandidate(candidates, {
      source: "Product Hunt",
      title: product.name,
      url: product.website || product.url,
      score: 52 + Math.min(44, product.votesCount / 8) + Math.min(18, product.commentsCount) + points,
      category: classify(text),
      why: [
        `${product.votesCount} votes / ${product.commentsCount} comments`,
        "Product Hunt 新产品榜",
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "产品发布信号",
      ],
      details: truncate(product.tagline),
      meta: { productHuntUrl: product.url, topics: product.topics, createdAt: product.createdAt },
    });
  }

  for (const model of hf.models.slice(0, 20)) {
    const text = `${model.id} ${model.pipelineTag} ${model.tags.join(" ")}`;
    const { points, hits } = scoreKeywords(text);
    addCandidate(candidates, {
      source: "Hugging Face",
      title: model.id,
      url: model.url,
      score: 30 + Math.min(36, model.likes / 4) + Math.min(20, Math.log10(model.downloads + 1) * 5) + points,
      category: "模型/多模态能力",
      why: [
        `${compactNumber(model.likes)} likes / ${compactNumber(model.downloads)} downloads`,
        model.pipelineTag ? `任务：${model.pipelineTag}` : "HF 近期高赞模型",
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "模型热度信号",
      ],
      details: truncate(model.tags.slice(0, 10).join(", ")),
      meta: { lastModified: model.lastModified, author: model.author },
    });
  }

  for (const article of devto.articles.slice(0, 15)) {
    const text = `${article.title} ${article.description} ${article.tags.join(" ")}`;
    const { points, hits } = scoreKeywords(text);
    if (points < 12 && article.positiveReactionsCount < 20) continue;
    addCandidate(candidates, {
      source: "Dev.to",
      title: article.title,
      url: article.url,
      score: 24 + Math.min(28, article.positiveReactionsCount / 2) + Math.min(14, article.commentsCount * 2) + points,
      category: classify(text),
      why: [
        `${article.positiveReactionsCount} reactions / ${article.commentsCount} comments`,
        `${article.readingTimeMinutes} min read`,
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "开发者社区内容",
      ],
      details: truncate(article.description),
      meta: { user: article.user, publishedAt: article.publishedAt, tags: article.tags },
    });
  }

  for (const story of lobsters.stories) {
    const text = `${story.title} ${story.tags.join(" ")}`;
    const { points, hits } = scoreKeywords(text);
    addCandidate(candidates, {
      source: "Lobste.rs",
      title: story.title,
      url: story.url || story.commentsUrl,
      score: 28 + Math.min(28, story.score * 2) + Math.min(18, story.commentCount * 3) + points,
      category: classify(text),
      why: [
        `${story.score} score / ${story.commentCount} comments`,
        `tags: ${story.tags.join(", ")}`,
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "技术社区信号",
      ],
      meta: { commentsUrl: story.commentsUrl, author: story.author, publishedAt: story.publishedAt },
    });
  }

  for (const paper of arxiv.papers.slice(0, 10)) {
    const text = `${paper.title} ${paper.summary} ${paper.categories.join(" ")}`;
    const { points, hits } = scoreKeywords(text);
    if (points < 12) continue;
    addCandidate(candidates, {
      source: "ArXiv",
      title: paper.title,
      url: paper.url,
      score: 22 + points,
      category: "论文/可产品化线索",
      why: [
        `分类：${paper.categories.join(", ")}`,
        `作者：${paper.authors.slice(0, 3).join(", ")}`,
        hits.length ? `关键词：${hits.slice(0, 5).join(", ")}` : "论文线索",
      ],
      details: truncate(paper.summary),
      meta: { pdfUrl: paper.pdfUrl, published: paper.published },
    });
  }

  for (const item of loadXCandidates()) addCandidate(candidates, item);

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_LIMIT)
    .map((item) => ({ ...item, score: Math.round(item.score) }));
}

function renderMarkdown(date: string, candidates: Candidate[]): string {
  const bySource = candidates.reduce<Record<string, number>>((acc, item) => {
    const source = displaySource(item);
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    `# 产品与工程雷达 - ${date}`,
    "",
    "目标：每天先筛出像 LifeManga 这种「有产品形态、可直接体验、可 fork/复刻/改造」的项目或工程线索。",
    "",
    "## 数据覆盖",
    ...Object.entries(bySource)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `- ${source}: ${count}`),
    "",
    "## 今日候选",
  ];

  candidates.forEach((item, index) => {
    lines.push("");
    lines.push(`### ${index + 1}. ${displayTitle(item)}`);
    lines.push(`- 来源：${displaySource(item)} / ${item.category} / 分数 ${item.score}`);
    if (item.url) lines.push(`- 链接：${item.url}`);
    for (const why of displayWhy(item).slice(0, 3)) lines.push(`- 信号：${why}`);
    if (displayDetails(item)) lines.push(`- 摘要：${displayDetails(item)}`);
  });

  lines.push("");
  lines.push("## 人工跟进建议");
  lines.push("- 优先点开分数 90+ 且带 GitHub、演示或 Show HN 的条目。");
  lines.push("- 看到产品形态清晰、README 完整、最近 7 天仍活跃的项目，先 clone 到本地试跑。");
  lines.push("- X/Twitter 源依赖 `../ai-x-digest/output/model_source_*_full_noreplies.json`；没有新文件时会复用最新一次抓取结果。");

  return `${lines.join("\n")}\n`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function scoreTone(score: number): string {
  if (score >= 115) return "hot";
  if (score >= 100) return "strong";
  if (score >= 85) return "watch";
  return "calm";
}

function renderSourceSummary(candidates: Candidate[]): string {
  const counts = candidates.reduce<Record<string, number>>((acc, item) => {
    const source = displaySource(item);
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([source, count]) => `
        <button class="source-pill" type="button" data-source="${escapeHtml(source)}">
          <span>${escapeHtml(source)}</span>
          <strong>${count}</strong>
        </button>
      `,
    )
    .join("");
}

function renderCandidateCard(item: Candidate, index: number): string {
  const source = escapeHtml(displaySource(item));
  const title = escapeHtml(displayTitle(item));
  const originalTitle = item.zhTitle && item.zhTitle !== item.title ? escapeHtml(item.title) : "";
  const details = escapeHtml(displayDetails(item));
  const category = escapeHtml(item.category);
  const url = escapeHtml(item.url);
  const score = Math.max(0, Math.min(140, item.score));
  const scorePercent = Math.round((score / 140) * 100);
  const tone = scoreTone(item.score);
  const link = item.url
    ? `<a class="open-link" href="${url}" target="_blank" rel="noreferrer">打开</a>`
    : "";

  return `
    <article class="candidate-card ${tone}" data-source="${source}" data-query="${escapeHtml(
      `${item.title} ${displayTitle(item)} ${item.source} ${displaySource(item)} ${item.category} ${item.details ?? ""} ${displayDetails(item)}`,
    ).toLowerCase()}">
      <div class="card-topline">
        <span class="rank">#${index + 1}</span>
        <span class="source">${source}</span>
        <span class="category">${category}</span>
      </div>
      <h2>${item.url ? `<a href="${url}" target="_blank" rel="noreferrer">${title}</a>` : title}</h2>
      ${originalTitle ? `<p class="original-title">${originalTitle}</p>` : ""}
      <div class="score-row">
        <span class="score-number">${item.score}</span>
        <div class="score-track"><span style="width: ${scorePercent}%"></span></div>
      </div>
      <ul class="signals">
        ${displayWhy(item)
          .slice(0, 3)
          .map((why) => `<li>${escapeHtml(why)}</li>`)
          .join("")}
      </ul>
      ${details ? `<p class="details">${details}</p>` : ""}
      <div class="card-actions">${link}</div>
    </article>
  `;
}

function renderHtml(date: string, candidates: Candidate[]): string {
  const topThree = candidates.slice(0, 3);
  const productLike = candidates.filter((item) => /产品|创作|可试用|GitHub|Hacker News|Product Hunt/.test(item.category)).length;
  const sourceCount = new Set(candidates.map(displaySource)).size;
  const highest = candidates[0]?.score ?? 0;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>产品与工程雷达 - ${escapeHtml(date)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f4ef;
      --surface: #fffdf8;
      --surface-2: #f0f7f3;
      --ink: #202124;
      --muted: #66706b;
      --line: #d8d7cf;
      --accent: #0f766e;
      --accent-2: #b45309;
      --accent-3: #5b5bd6;
      --hot: #c2410c;
      --strong: #0f766e;
      --watch: #4f46e5;
      --shadow: 0 18px 50px rgba(34, 31, 25, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
      color: var(--ink);
      background:
        linear-gradient(180deg, rgba(15,118,110,0.08), rgba(180,83,9,0.05) 42%, transparent 70%),
        var(--bg);
    }
    a { color: inherit; text-decoration: none; }
    .page { max-width: 1180px; margin: 0 auto; padding: 28px 22px 48px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
      gap: 22px;
      align-items: stretch;
      margin-bottom: 22px;
    }
    .hero-main {
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .eyebrow { margin: 0 0 8px; color: var(--accent); font-weight: 750; font-size: 13px; }
    h1 {
      margin: 0;
      max-width: 780px;
      font-size: clamp(30px, 4vw, 54px);
      line-height: 1.02;
      letter-spacing: 0;
    }
    .hero-copy { margin: 16px 0 0; max-width: 720px; color: var(--muted); font-size: 16px; line-height: 1.75; }
    .hero-side {
      display: grid;
      gap: 12px;
    }
    .metric {
      min-height: 104px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,253,248,0.86);
    }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric strong { display: block; margin-top: 8px; font-size: 30px; line-height: 1; }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 5;
      margin: 0 0 20px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,253,248,0.94);
      backdrop-filter: blur(16px);
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 12px;
      align-items: center;
    }
    .search {
      width: 100%;
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
      background: white;
      color: var(--ink);
    }
    .source-pills { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .source-pill {
      height: 34px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 11px;
      background: white;
      color: var(--ink);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
    }
    .source-pill.active { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
    .source-pill strong {
      min-width: 22px;
      height: 22px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--accent);
      font-size: 12px;
    }
    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin: 24px 0 12px;
    }
    .section-title h2 { margin: 0; font-size: 20px; }
    .section-title span { color: var(--muted); font-size: 13px; }
    .top-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .candidate-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .candidate-card {
      min-height: 280px;
      padding: 18px;
      border: 1px solid var(--line);
      border-left: 5px solid var(--accent);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 10px 30px rgba(34, 31, 25, 0.06);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .candidate-card.hot { border-left-color: var(--hot); }
    .candidate-card.strong { border-left-color: var(--strong); }
    .candidate-card.watch { border-left-color: var(--watch); }
    .candidate-card.hidden { display: none; }
    .card-topline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-height: 28px;
    }
    .rank {
      width: 36px;
      height: 26px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      background: #1f2937;
      color: white;
      font-size: 12px;
      font-weight: 800;
    }
    .source, .category {
      min-height: 26px;
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0 10px;
      font-size: 12px;
      color: var(--muted);
      border: 1px solid var(--line);
      background: #fff;
    }
    .candidate-card h2 {
      margin: 0;
      font-size: 19px;
      line-height: 1.3;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .candidate-card h2 a:hover { color: var(--accent); }
    .original-title {
      margin: -4px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .score-row {
      display: grid;
      grid-template-columns: 46px 1fr;
      gap: 10px;
      align-items: center;
    }
    .score-number { font-weight: 850; font-size: 22px; color: var(--accent-2); }
    .score-track {
      height: 9px;
      border-radius: 999px;
      background: #ebe7dd;
      overflow: hidden;
    }
    .score-track span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }
    .signals {
      margin: 0;
      padding: 0 0 0 18px;
      color: #3f4742;
      font-size: 14px;
      line-height: 1.55;
    }
    .signals li + li { margin-top: 5px; }
    .details {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }
    .card-actions { margin-top: auto; display: flex; justify-content: flex-end; }
    .open-link {
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      padding: 0 14px;
      background: #202124;
      color: white;
      font-size: 13px;
      font-weight: 750;
    }
    .empty {
      display: none;
      padding: 28px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      color: var(--muted);
      background: rgba(255,255,255,0.55);
      text-align: center;
    }
    .empty.visible { display: block; }
    .footer-note {
      margin-top: 28px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
    }
    @media (max-width: 900px) {
      .hero, .candidate-grid, .top-grid { grid-template-columns: 1fr; }
      .toolbar { grid-template-columns: 1fr; }
      .source-pills { justify-content: flex-start; }
    }
    @media (max-width: 560px) {
      .page { padding: 16px 12px 34px; }
      .hero-main { padding: 20px; }
      .candidate-card { min-height: 0; }
      .metric { min-height: 88px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="hero-main">
        <p class="eyebrow">产品与工程雷达 / ${escapeHtml(date)}</p>
        <h1>今天值得点开的产品和工程线索</h1>
        <p class="hero-copy">我已经把英文标题和摘要整理成自然中文；仓库名、产品名这类专有名词会保留原文，方便你点开后对照。</p>
      </div>
      <div class="hero-side">
        <div class="metric"><span>候选条目</span><strong>${candidates.length}</strong></div>
        <div class="metric"><span>覆盖来源</span><strong>${sourceCount}</strong></div>
        <div class="metric"><span>最高分</span><strong>${highest}</strong></div>
      </div>
    </section>

    <section class="toolbar" aria-label="筛选">
      <input class="search" id="search" placeholder="搜索项目、来源、关键词..." autocomplete="off">
      <div class="source-pills">
        <button class="source-pill active" type="button" data-source="all"><span>全部来源</span><strong>${candidates.length}</strong></button>
        ${renderSourceSummary(candidates)}
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>优先看这 3 个</h2>
        <span>${productLike} 条偏产品/可体验线索</span>
      </div>
      <div class="top-grid">
        ${topThree.map((item, index) => renderCandidateCard(item, index)).join("")}
      </div>
    </section>

    <section>
      <div class="section-title">
        <h2>完整候选</h2>
        <span id="visible-count">${candidates.length} 条</span>
      </div>
      <div class="candidate-grid" id="candidate-grid">
        ${candidates.map((item, index) => renderCandidateCard(item, index)).join("")}
      </div>
      <div class="empty" id="empty">没有匹配的条目。</div>
    </section>

    <p class="footer-note">Product Hunt 需要配置 PRODUCTHUNT_TOKEN；没有 token 时会跳过。X/Twitter 数据来自本机 ai-x-digest 最近一次输出。专有名词保留英文，解释和摘要优先使用中文。</p>
  </main>
  <script>
    const buttons = [...document.querySelectorAll(".source-pill")];
    const search = document.querySelector("#search");
    const cards = [...document.querySelectorAll("#candidate-grid .candidate-card")];
    const count = document.querySelector("#visible-count");
    const empty = document.querySelector("#empty");
    let activeSource = "all";

    function applyFilters() {
      const query = (search.value || "").trim().toLowerCase();
      let visible = 0;
      for (const card of cards) {
        const sourceOk = activeSource === "all" || card.dataset.source === activeSource;
        const queryOk = !query || (card.dataset.query || "").includes(query);
        const show = sourceOk && queryOk;
        card.classList.toggle("hidden", !show);
        if (show) visible += 1;
      }
      count.textContent = visible + " 条";
      empty.classList.toggle("visible", visible === 0);
    }

    for (const button of buttons) {
      button.addEventListener("click", () => {
        activeSource = button.dataset.source || "all";
        for (const item of buttons) item.classList.toggle("active", item === button);
        applyFilters();
      });
    }
    search.addEventListener("input", applyFilters);
  </script>
</body>
</html>`;
}

function encodeBase64Lines(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/.{1,76}/g, "$&\n").trimEnd();
}

function renderMhtml(date: string, html: string): string {
  const boundary = "----=_ProductScout_Report";
  return `From: <Saved by Product Scout>
Subject: 产品与工程雷达 - ${date}
MIME-Version: 1.0
Content-Type: multipart/related; type="text/html"; boundary="${boundary}"

--${boundary}
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: base64
Content-Location: product-scout-${date}.html

${encodeBase64Lines(html)}
--${boundary}--
`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const date = nowInChina();
  const candidates = (await buildCandidates()).map(localizeCandidate);
  const jsonPath = path.join(OUTPUT_DIR, `${date}.json`);
  const mdPath = path.join(OUTPUT_DIR, `${date}.md`);
  const htmlPath = path.join(OUTPUT_DIR, `${date}.html`);
  const mhtmlPath = path.join(OUTPUT_DIR, `${date}.mhtml`);
  const html = renderHtml(date, candidates);
  fs.writeFileSync(jsonPath, JSON.stringify({ date, candidates }, null, 2), "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(date, candidates), "utf8");
  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(mhtmlPath, renderMhtml(date, html), "utf8");
  fs.copyFileSync(jsonPath, path.join(OUTPUT_DIR, "latest.json"));
  fs.copyFileSync(mdPath, path.join(OUTPUT_DIR, "latest.md"));
  fs.copyFileSync(htmlPath, path.join(OUTPUT_DIR, "latest.html"));
  fs.copyFileSync(mhtmlPath, path.join(OUTPUT_DIR, "latest.mhtml"));
  console.log(`Wrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${htmlPath}`);
  console.log(`Wrote ${mhtmlPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
