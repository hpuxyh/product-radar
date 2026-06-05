#!/usr/bin/env node
// build-radar-page.mjs
// 读取最新的 digests/<date>/new-projects.json，生成一个独立的精美中文展示页 radar.html。
// 数据完全复用现有 new-projects.json（其中的中文描述/亮点本就提炼自项目 README）。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const digestsDir = join(root, 'digests');

// 找到最新一天的 new-projects.json
function findLatest() {
  if (!existsSync(digestsDir)) return null;
  const days = readdirSync(digestsDir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => existsSync(join(digestsDir, d, 'new-projects.json')))
    .sort();
  if (!days.length) return null;
  const date = days[days.length - 1];
  return { date, file: join(digestsDir, date, 'new-projects.json') };
}

const latest = findLatest();
if (!latest) {
  console.error('[radar] 没找到 digests/*/new-projects.json，先跑 pnpm new-projects');
  process.exit(0);
}

const raw = JSON.parse(readFileSync(latest.file, 'utf8'));
const MAX = Number(process.env.RADAR_MAX || 60);

const projects = (raw.projects || [])
  .slice()
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, MAX)
  .map((p) => ({
    name: p.fullName || '',
    url: p.url || (p.fullName ? `https://github.com/${p.fullName}` : '#'),
    tag: p.categoryZh || '',
    what: p.descriptionZh || '',
    audience: p.audienceZh || '',
    feats: (p.readmeHighlightsZh || []).slice(0, 3),
    tags: (p.trendLabelsZh || []).slice(0, 2),
    lang: p.language || '—',
    stars: p.stars || 0,
    forks: p.forks || 0,
  }));

const DATA = JSON.stringify({
  date: raw.date || latest.date,
  scanned: raw.uniqueRepos || 0,
  total: projects.length,
  projects,
});

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 项目深度雷达 · ${raw.date || latest.date}</title>
<style>
:root{--bg:#f6f8fb;--card:#ffffff;--line:#e8ecf2;--txt:#1f2733;--dim:#5b6573;--dim2:#929aa8;--a:#2f6df0;--a-soft:#eef3fe;--am:#c2410c;--am-soft:#fff3ec;--gr:#0a9d6e;--purple:#6d54d6;--purple-soft:#f1eefc;--shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:0 22px 90px}
header{padding:60px 0 26px;text-align:center}
.badge{display:inline-block;font-size:12px;letter-spacing:.08em;color:var(--a);background:var(--a-soft);padding:6px 16px;border-radius:999px;margin-bottom:20px;font-weight:600}
h1{font-size:38px;margin:0 0 14px;font-weight:800;letter-spacing:-.02em;color:#141b26}
header p{color:var(--dim);max-width:640px;margin:0 auto;font-size:15px}
.nav{margin-top:18px;font-size:13px}.nav a{color:var(--a);text-decoration:none;margin:0 8px;font-weight:500}.nav a:hover{text-decoration:underline}
.stats{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:28px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 24px;min-width:108px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:23px;color:#141b26;font-weight:700}.stat span{font-size:12px;color:var(--dim)}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:34px 0 4px;flex-wrap:wrap}
.cnt{color:var(--dim);font-size:13px}.cnt b{color:#141b26}
.search{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 15px;color:var(--txt);font-size:14px;min-width:240px;outline:none;box-shadow:var(--shadow);transition:.15s}
.search::placeholder{color:var(--dim2)}
.search:focus{border-color:var(--a);box-shadow:0 0 0 3px var(--a-soft)}
.list{display:flex;flex-direction:column;gap:14px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 24px;transition:.18s;position:relative;box-shadow:var(--shadow)}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(16,24,40,.06),0 18px 40px rgba(47,109,240,.1);border-color:#d4ddf0}
.top{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.idx{font-size:13px;font-weight:700;color:var(--a);background:var(--a-soft);width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}
.tt{flex:1;min-width:200px}
.nm{font-size:18px;font-weight:700;color:#141b26;text-decoration:none}.nm:hover{color:var(--a)}
.tag{font-size:13px;color:var(--dim);margin-top:2px}
.stat2{display:flex;gap:14px;font-size:12.5px;color:var(--dim);align-items:center;flex-wrap:wrap}
.lang{display:inline-flex;align-items:center;gap:5px;color:var(--txt);font-weight:500}.dot{width:9px;height:9px;border-radius:50%;background:var(--a)}
.aud{font-size:12px;color:var(--am);background:var(--am-soft);padding:4px 11px;border-radius:8px;display:inline-block;margin-top:12px;font-weight:500}
.what{font-size:14px;color:#39424f;margin:12px 0 0}
.feats{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.feats li{font-size:12.5px;color:var(--dim);background:#f4f6fa;border-radius:8px;padding:6px 11px}
.feats li:before{content:"✓ ";color:var(--gr);font-weight:700}
.foot2{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center}
.chip{font-size:11px;color:var(--purple);background:var(--purple-soft);padding:3px 10px;border-radius:6px;font-weight:500}
.gh{margin-left:auto;font-size:12.5px;color:var(--a);text-decoration:none;border:1px solid #cfdcf8;padding:6px 14px;border-radius:9px;transition:.15s;font-weight:500}
.gh:hover{background:var(--a);color:#fff;border-color:var(--a)}
.foot{text-align:center;color:var(--dim2);font-size:12px;margin-top:54px;line-height:1.8}
.hidden{display:none}
@media(max-width:600px){h1{font-size:29px}.card{padding:18px}}
</style></head>
<body><div class="wrap">
<header>
<div class="badge">AI 生态情报雷达 · 深度版</div>
<h1>值得一看的 AI 项目</h1>
<p>每天从 GitHub、Hacker News、Hugging Face、Product Hunt 等来源，筛出有产品形态、能试用、能 fork、能改造的 AI 项目，并整理出「它是什么、能干嘛、有什么特点」。</p>
<div class="nav"><a href="index.html">← 返回首页</a> · <a href="new-projects.html">原始新项目页</a></div>
<div class="stats" id="stats"></div>
</header>
<div class="toolbar"><div class="cnt">共 <b id="cn">0</b> 个项目 · 按评分排序</div><input class="search" id="q" placeholder="搜索项目名 / 描述 / 关键词…"></div>
<div class="list" id="list"></div>
<div class="foot">数据源：本仓库 digests/<span id="dt"></span>/new-projects.json · 中文描述与亮点提炼自各项目 README<br>本页由 scripts/build-radar-page.mjs 自动生成</div>
</div>
<script>
const D=${DATA};
function fmt(n){n=+n||0;return n>=1000?(n/1000).toFixed(1).replace(/\\.0$/,'')+'k':''+n;}
function esc(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
document.getElementById('dt').textContent=D.date;
document.getElementById('cn').textContent=D.total;
document.getElementById('stats').innerHTML=[[D.total,'精选项目'],[fmt(D.scanned),'当天扫描仓库'],['08:00','每日更新(CST)'],['10','数据源']].map(s=>'<div class="stat"><b>'+s[0]+'</b><span>'+s[1]+'</span></div>').join('');
function card(p,i){
 const f=(p.feats||[]).map(x=>'<li>'+esc(x)+'</li>').join('');
 const c=(p.tags||[]).filter(Boolean).map(x=>'<span class="chip">'+esc(x)+'</span>').join('');
 const aud=p.audience?'<div class="aud">适合：'+esc(p.audience)+'</div>':'';
 return '<div class="card" data-s="'+esc((p.name+' '+p.tag+' '+p.what+' '+(p.tags||[]).join(' ')).toLowerCase())+'">'
 +'<div class="top"><div class="idx">'+(i+1)+'</div>'
 +'<div class="tt"><a class="nm" href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.name)+'</a><div class="tag">'+esc(p.tag)+'</div></div>'
 +'<div class="stat2"><span class="lang"><span class="dot"></span>'+esc(p.lang)+'</span><span>★ '+fmt(p.stars)+'</span><span>⑂ '+fmt(p.forks)+'</span></div></div>'
 +aud
 +'<p class="what">'+esc(p.what)+'</p>'
 +'<ul class="feats">'+f+'</ul>'
 +'<div class="foot2">'+c+'<a class="gh" href="'+esc(p.url)+'" target="_blank" rel="noopener">进 GitHub →</a></div>'
 +'</div>';
}
document.getElementById('list').innerHTML=D.projects.map(card).join('');
document.getElementById('q').addEventListener('input',e=>{
 const q=e.target.value.trim().toLowerCase();let n=0;
 document.querySelectorAll('.card').forEach(c=>{const h=q&&!c.dataset.s.includes(q);c.classList.toggle('hidden',h);if(!h)n++;});
 document.getElementById('cn').textContent=n;
});
</script></body></html>`;

writeFileSync(join(root, 'radar.html'), html);
console.log(`[radar] 已生成 radar.html（来源 ${latest.date}，${projects.length} 个项目）`);
