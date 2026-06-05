import { describe, expect, it } from "vitest";
import {
  buildNewProjectsMarkdown,
  materializeQuery,
  rankProjects,
  scoreProject,
  type NewProject,
  type NewProjectsConfig,
} from "../new-projects.ts";

const CONFIG: NewProjectsConfig = {
  lookbackDays: 2,
  minStars: 2,
  maxResults: 20,
  perQuery: 10,
  createIssue: false,
  exclude: [],
  queries: [
    {
      label: "Web",
      category: "Web / Frontend",
      q: "topic:web created:>={since} stars:>={minStars}",
      weight: 12,
    },
    {
      label: "Coding Agents",
      category: "AI Coding / Agents",
      q: "topic:ai-agent created:>={since} stars:>={minStars}",
      weight: 13,
    },
  ],
};

function project(overrides: Partial<NewProject> = {}): NewProject {
  return {
    fullName: "demo/project",
    url: "https://github.com/demo/project",
    description: "A web coding agent app with a live dashboard",
    language: "TypeScript",
    stars: 12,
    forks: 2,
    openIssues: 1,
    topics: ["web", "ai-agent", "react"],
    homepage: "https://example.com",
    license: "MIT",
    owner: "demo",
    ownerAvatarUrl: "",
    createdAt: "2026-06-03T00:00:00Z",
    pushedAt: "2026-06-04T00:00:00Z",
    updatedAt: "2026-06-04T00:00:00Z",
    matchedQueries: ["Web"],
    matchedCategories: ["Web / Frontend"],
    searchQueries: ["topic:web created:>=2026-06-03 stars:>=2"],
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
    ...overrides,
  };
}

describe("materializeQuery", () => {
  it("fills placeholders and adds missing guards", () => {
    const result = materializeQuery("topic:web pushed:>={since}", "2026-06-03", 2);
    expect(result).toContain("pushed:>=2026-06-03");
    expect(result).toContain("created:>=2026-06-03");
    expect(result).toContain("stars:>=2");
  });
});

describe("scoreProject", () => {
  it("classifies and explains strong new projects", () => {
    const scored = scoreProject(project(), CONFIG, new Date("2026-06-04T12:00:00Z"));
    expect(scored.score).toBeGreaterThan(80);
    expect(scored.aiPotentialScore).toBeGreaterThan(80);
    expect(scored.webTrendScore).toBeGreaterThan(80);
    expect(scored.categoryZh).toBe("AI 工具项目");
    expect(scored.reasonsZh.join("\n")).toContain("人收藏");
    expect(scored.reasonsZh.join("\n")).toContain("网站项目");
    expect(scored.frontierReasonsZh.join("\n")).toContain("可能值得看");
    expect(scored.webTrendReasonsZh.join("\n")).toContain("它代表的趋势");
  });
});

describe("rankProjects", () => {
  it("sorts by the stronger of AI potential and Web trend scores", () => {
    const low = project({ fullName: "demo/low", stars: 1, topics: ["web"], matchedQueries: ["Web"] });
    const high = project({
      fullName: "demo/high",
      stars: 50,
      topics: ["web", "ai-agent", "react"],
      matchedQueries: ["Web", "Coding Agents"],
    });
    const ranked = rankProjects([low, high], CONFIG, new Date("2026-06-04T12:00:00Z"));
    expect(ranked[0]!.fullName).toBe("demo/high");
  });
});

describe("buildNewProjectsMarkdown", () => {
  it("renders linked projects in zh", () => {
    const now = new Date("2026-06-04T12:00:00Z");
    const ranked = rankProjects([project()], CONFIG, now);
    const meta = {
      dateStr: "2026-06-04",
      utcStr: "2026-06-04 12:00",
      sinceDate: "2026-06-02",
      generatedAt: now.toISOString(),
      lookbackDays: 2,
      totalRaw: 1,
      totalUnique: 1,
      activeQueries: CONFIG.queries,
    };

    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("新项目发现榜");
    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("AI 可能会火");
    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("大家在做的产品");
    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("手机/App 项目");
    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("这期大家集中在做什么");
    expect(buildNewProjectsMarkdown(ranked, meta, "zh")).toContain("[demo/project]");
  });
});
