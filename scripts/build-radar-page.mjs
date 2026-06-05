#!/usr/bin/env node
// build-radar-page.mjs
// 读取最新的 digests/<date>/new-projects.json，生成一个独立的中文展示页 radar.html。
// 设计：参考苹果官网的清新、克制、留白；带分类筛选 / 排序 / 搜索。
// 数据完全复用现有 new-projects.json（中文描述/亮点本就提炼自项目 README）。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const digestsDir = join(root, 'digests');

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

// 分类归一：把冗长的 categoryZh 收敛成简短的筛选标签
function shortCat(c) {
  if (!c) return '其他';
  if (c.includes('手机') || c.includes('App')) return '手机 App';
  if (c.includes('网站') || c.includes('网页')) return '网站网页';
  if (c.includes('工具')) return 'AI 工具';
  return '其他';
}

const projects = (raw.projects || [])
  .slice()
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, MAX)
  .map((p) => ({
    name: p.fullName || '',
    url: p.url || (p.fullName ? `https://github.com/${p.fullName}` : '#'),
    cat: shortCat(p.categoryZh),
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
<title>AI 项目雷达 · ${raw.date || latest.date}</title>
<style>
:root{
  --bg:#ffffff;--bg2:#f5f5f7;--ink:#1d1d1f;--ink2:#6e6e73;--ink3:#86868b;
  --line:#e3e3e6;--blue:#0071e3;--blue-d:#0066cc;--card:#ffffff;
  --radius:20px;--max:1000px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"SF Pro Display","SF Pro Text",-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Roboto,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--blue);text-decoration:none}
.wrap{max-width:var(--max);margin:0 auto;padding:0 22px}

/* Hero */
.hero{text-align:center;padding:96px 0 60px}
.kicker{font-size:15px;font-weight:600;color:var(--blue);letter-spacing:.01em;margin:0 0 12px}
.hero h1{font-size:clamp(40px,7vw,68px);line-height:1.05;letter-spacing:-.025em;font-weight:700;margin:0 0 20px}
.hero .sub{font-size:clamp(18px,2.4vw,23px);line-height:1.45;color:var(--ink2);max-width:600px;margin:0 auto;font-weight:400}
.metaline{margin-top:26px;font-size:14px;color:var(--ink3)}
.metaline b{color:var(--ink);font-weight:600}

/* How-to strip */
.how{background:var(--bg2);border-radius:var(--radius);max-width:760px;margin:40px auto 0;padding:22px 26px;
  display:flex;gap:30px;justify-content:center;flex-wrap:wrap;text-align:left}
.how .it{display:flex;gap:12px;align-items:flex-start;max-width:220px}
.how .n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;
  font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:1px}
.how .t{font-size:13.5px;color:var(--ink2);line-height:1.45}
.how .t b{color:var(--ink);font-weight:600;display:block;font-size:14px}

/* Sticky filter bar */
.bar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.82);
  backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
  border-bottom:1px solid var(--line);margin-top:56px}
.bar .inner{max-width:var(--max);margin:0 auto;padding:13px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.segs{display:flex;gap:6px;flex-wrap:wrap}
.seg{border:none;background:transparent;color:var(--ink2);font-size:14px;font-weight:500;
  padding:7px 16px;border-radius:999px;cursor:pointer;transition:.18s;font-family:inherit;white-space:nowrap}
.seg:hover{background:var(--bg2);color:var(--ink)}
.seg.on{background:var(--ink);color:#fff}
.seg .c{opacity:.55;margin-left:5px;font-size:12px}
.seg.on .c{opacity:.7}
.spacer{flex:1 1 40px}
.sort{border:1px solid var(--line);background:var(--card);border-radius:999px;color:var(--ink);
  font-size:13.5px;padding:7px 14px;font-family:inherit;cursor:pointer;outline:none}
.search{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 16px;
  font-size:14px;font-family:inherit;color:var(--ink);outline:none;min-width:190px;transition:.18s}
.search::placeholder{color:var(--ink3)}
.search:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(0,113,227,.12)}

/* Grid */
.count{max-width:var(--max);margin:30px auto 0;padding:0 22px;font-size:14px;color:var(--ink3)}
.grid{max-width:var(--max);margin:14px auto 0;padding:0 22px 110px;
  display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
@media(max-width:760px){.grid{grid-template-columns:1fr}.how{gap:18px}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:24px 24px 20px;display:flex;flex-direction:column;transition:.2s;position:relative}
.card:hover{box-shadow:0 12px 36px rgba(0,0,0,.09);transform:translateY(-3px);border-color:#d8d8dc}
.chead{display:flex;align-items:center;gap:10px;margin-bottom:3px}
.rank{font-size:12px;font-weight:600;color:var(--ink3);font-variant-numeric:tabular-nums}
.pill{font-size:11.5px;font-weight:600;color:var(--blue-d);background:#eef5fd;padding:3px 10px;border-radius:999px}
.nm{font-size:19px;font-weight:600;letter-spacing:-.01em;color:var(--ink);margin:2px 0 0;line-height:1.25}
.nm a{color:inherit}.nm a:hover{color:var(--blue)}
.what{font-size:14.5px;color:var(--ink2);margin:11px 0 0;line-height:1.5;flex:0 0 auto}
.aud{font-size:12.5px;color:var(--ink2);margin-top:12px}
.aud b{color:var(--ink);font-weight:600}
.feats{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.feats li{font-size:13px;color:var(--ink2);padding-left:20px;position:relative;line-height:1.4}
.feats li:before{content:"";position:absolute;left:3px;top:7px;width:6px;height:6px;border-radius:50%;background:#34c759}
.foot{display:flex;align-items:center;gap:16px;margin-top:18px;padding-top:15px;border-top:1px solid var(--line);
  font-size:12.5px;color:var(--ink3);font-variant-numeric:tabular-nums}
.lang{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:500}
.dot{width:9px;height:9px;border-radius:50%;background:var(--blue)}
.gh{margin-left:auto;color:var(--blue);font-weight:500}
.gh:hover{text-decoration:underline}
.empty{grid-column:1/-1;text-align:center;color:var(--ink3);padding:60px 0;font-size:15px}
.pagefoot{text-align:center;color:var(--ink3);font-size:12.5px;padding:0 22px 70px;line-height:1.8}
.hidden{display:none}
</style></head>
<body>

<div class="wrap">
  <div class="hero">
    <p class="kicker">AI 生态项目雷达</p>
    <h1>每天，帮你找到<br>值得一看的 AI 项目。</h1>
    <p class="sub">从 GitHub、Hacker News、Hugging Face 等来源，自动筛出能试用、能 fork、能改造的项目，并整理成中文一句话看懂。</p>
    <p class="metaline">本期 <b id="mDate"></b> · 精选 <b id="mTotal"></b> 个 · 当天扫描 <b id="mScan"></b> 个仓库</p>

    <div class="how">
      <div class="it"><div class="n">1</div><div class="t"><b>选分类</b>用上方标签按「AI 工具 / 手机 App / 网站」筛选</div></div>
      <div class="it"><div class="n">2</div><div class="t"><b>看排名</b>默认按热度排序，越靠前越值得先看</div></div>
      <div class="it"><div class="n">3</div><div class="t"><b>点进去</b>感兴趣就点「GitHub」直达项目主页</div></div>
    </div>
  </div>
</div>

<div class="bar"><div class="inner">
  <div class="segs" id="segs"></div>
  <div class="spacer"></div>
  <select class="sort" id="sort">
    <option value="score">热度排序</option>
    <option value="stars">收藏最多</option>
  </select>
  <input class="search" id="q" placeholder="搜索项目 / 关键词">
</div></div>

<div class="count" id="count"></div>
<div class="grid" id="grid"></div>

<div class="pagefoot">
  数据源：本仓库 digests/<span id="dt"></span>/new-projects.json · 中文描述与亮点提炼自各项目 README<br>
  <a href="index.html">返回首页</a> · <a href="new-projects.html">原始新项目页</a>
</div>

<script>
const D=${DATA};
let state={cat:'全部',sort:'score',q:''};

function fmt(n){n=+n||0;return n>=1000?(n/1000).toFixed(1).replace(/\\.0$/,'')+'k':''+n;}
function esc(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

document.getElementById('mDate').textContent=D.date;
document.getElementById('mTotal').textContent=D.total;
document.getElementById('mScan').textContent=fmt(D.scanned);
document.getElementById('dt').textContent=D.date;

// 分类筛选标签（含数量），按数量排序
const catCount={};
D.projects.forEach(p=>{catCount[p.cat]=(catCount[p.cat]||0)+1;});
const cats=['全部',...Object.keys(catCount).sort((a,b)=>catCount[b]-catCount[a])];
document.getElementById('segs').innerHTML=cats.map((c,i)=>{
  const n=c==='全部'?D.total:catCount[c];
  return '<button class="seg'+(i===0?' on':'')+'" data-c="'+esc(c)+'">'+esc(c)+'<span class="c">'+n+'</span></button>';
}).join('');

function card(p,i){
  const f=(p.feats||[]).map(x=>'<li>'+esc(x)+'</li>').join('');
  const aud=p.audience?'<div class="aud"><b>适合：</b>'+esc(p.audience)+'</div>':'';
  return '<article class="card">'
    +'<div class="chead"><span class="rank">#'+(i+1)+'</span><span class="pill">'+esc(p.cat)+'</span></div>'
    +'<h2 class="nm"><a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.name)+'</a></h2>'
    +'<p class="what">'+esc(p.what)+'</p>'
    +aud
    +'<ul class="feats">'+f+'</ul>'
    +'<div class="foot"><span class="lang"><span class="dot"></span>'+esc(p.lang)+'</span>'
    +'<span>★ '+fmt(p.stars)+'</span><span>⑂ '+fmt(p.forks)+'</span>'
    +'<a class="gh" href="'+esc(p.url)+'" target="_blank" rel="noopener">GitHub ↗</a></div>'
    +'</article>';
}

function render(){
  let list=D.projects.filter(p=>state.cat==='全部'||p.cat===state.cat);
  if(state.q){const q=state.q.toLowerCase();
    list=list.filter(p=>(p.name+' '+p.what+' '+p.cat+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q));}
  if(state.sort==='stars')list=list.slice().sort((a,b)=>(b.stars||0)-(a.stars||0));
  const g=document.getElementById('grid');
  g.innerHTML=list.length?list.map(card).join(''):'<div class="empty">没有匹配的项目，换个分类或关键词试试。</div>';
  document.getElementById('count').textContent='显示 '+list.length+' 个项目'+(state.cat!=='全部'?' · '+state.cat:'')+(state.q?' · 搜索“'+state.q+'”':'');
}

document.getElementById('segs').addEventListener('click',e=>{
  const b=e.target.closest('.seg');if(!b)return;
  document.querySelectorAll('.seg').forEach(s=>s.classList.remove('on'));
  b.classList.add('on');state.cat=b.dataset.c;render();
});
document.getElementById('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
document.getElementById('q').addEventListener('input',e=>{state.q=e.target.value.trim();render();});

render();
</script>
</body></html>`;

writeFileSync(join(root, 'radar.html'), html);
console.log(`[radar] 已生成 radar.html（来源 ${latest.date}，${projects.length} 个项目）`);
