# 本地产品/工程观测入口

这个仓库本身已经能做完整的 AI 生态日报，但完整模式需要 `GITHUB_TOKEN` 和 LLM API key。

我额外加了一个轻量入口：

```bash
cd "/Users/xieyahao/Documents/New project1/agents-radar"
corepack pnpm scout
```

它不调用 LLM，先用公开数据源筛出每天值得点开的产品/工程候选：

- GitHub Trending
- GitHub Search AI topics
- Hacker News
- Hugging Face
- Dev.to
- Lobste.rs
- ArXiv
- Product Hunt（如果设置了 `PRODUCTHUNT_TOKEN`）
- 本机已有的 `../ai-x-digest/output/model_source_*_full_noreplies.json`

输出文件：

```text
scout/latest.md
scout/latest.json
scout/latest.html
scout/latest.mhtml
```

筛选口味按 `LifeManga` 这类项目调过：更偏向有产品形态、能直接体验、能 clone/fork、最近热度上升、带 demo/GitHub/Show HN 信号的项目。

日常浏览优先打开：

```text
scout/latest.html
```

如果想要单文件归档，打开或转发：

```text
scout/latest.mhtml
```

如果以后要做更细的“我喜欢什么”，优先改：

```text
scripts/local-scout.ts
```

里面的 `PRODUCT_WORDS`、`CREATIVE_WORDS`、`INFRA_WORDS` 和打分逻辑都很直白。
