#!/usr/bin/env node
// build-radar-page.mjs
// 生成面向「纯小白」的 AI 项目展示页 radar.html。
// 设计：参考苹果官网的清新克制 + 大留白；带分类筛选 / 排序 / 搜索。
// 文案来源优先级：digests/<date>/radar-enriched.json（小白三段式：是什么/能干什么/为什么重要）
//   —— 该文件由 scripts/enrich-radar.ts 自动生成（读 README + 大模型翻译），也可手工维护。
//   未被 enrich 的项目回退到 new-projects.json 的原始字段。
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
const byName = new Map((raw.projects || []).map((p) => [p.fullName, p]));

// 读取小白文案（如有）
const enrichedPath = join(digestsDir, latest.date, 'radar-enriched.json');
let enriched = [];
if (existsSync(enrichedPath)) {
  try {
    enriched = JSON.parse(readFileSync(enrichedPath, 'utf8')).items || [];
  } catch {
    enriched = [];
  }
}

// 以 enriched 为主（小白版优先），合并 new-projects.json 的硬数据
const projects = enriched
  .map((e) => {
    const base = byName.get(e.fullName) || {};
    return {
      name: e.fullName,
      url: base.url || `https://github.com/${e.fullName}`,
      cat: e.category || '其他',
      whatIs: e.whatIs || base.descriptionZh || '',
      forYou: e.forYou || '',
      whyMatters: e.whyMatters || '',
      lang: base.language || '—',
      stars: base.stars || 0,
      forks: base.forks || 0,
      score: base.score || 0,
    };
  })
  .sort((a, b) => (b.score || 0) - (a.score || 0));

if (!projects.length) {
  console.error('[radar] radar-enriched.json 为空，跳过生成。先跑 pnpm enrich');
  process.exit(0);
}

const DATA = JSON.stringify({
  date: raw.date || latest.date,
  scanned: raw.uniqueRepos || 0,
  total: projects.length,
  projects,
});

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 项目雷达 · 小白也能看懂 · ${raw.date || latest.date}</title>
<style>
:root{
  --bg:#ffffff;--bg2:#f5f5f7;--ink:#1d1d1f;--ink2:#6e6e73;--ink3:#86868b;
  --line:#e6e6e9;--blue:#0071e3;--blue-d:#0066cc;--card:#ffffff;
  --green:#34c759;--amber:#ff9f0a;--radius:20px;--max:1040px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"SF Pro Display","SF Pro Text",-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Roboto,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--blue);text-decoration:none}
.wrap{max-width:var(--max);margin:0 auto;padding:0 22px}

/* Hero */
.hero{text-align:center;padding:92px 0 16px}
.kicker{font-size:15px;font-weight:600;color:var(--blue);margin:0 0 12px}
.hero h1{font-size:clamp(38px,6.4vw,62px);line-height:1.06;letter-spacing:-.025em;font-weight:700;margin:0 0 20px}
.hero .sub{font-size:clamp(17px,2.2vw,21px);line-height:1.5;color:var(--ink2);max-width:600px;margin:0 auto;font-weight:400}
.metaline{margin-top:24px;font-size:14px;color:var(--ink3)}
.metaline b{color:var(--ink);font-weight:600}

/* How-to */
.how{background:var(--bg2);border-radius:var(--radius);max-width:780px;margin:40px auto 0;padding:24px 26px;
  display:grid;grid-template-columns:repeat(3,1fr);gap:22px;text-align:left}
@media(max-width:680px){.how{grid-template-columns:1fr;gap:16px}}
.how .it{display:flex;gap:12px;align-items:flex-start}
.how .n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;
  font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:1px}
.how .t{font-size:13.5px;color:var(--ink2);line-height:1.5}
.how .t b{color:var(--ink);font-weight:600;display:block;font-size:14px;margin-bottom:1px}

/* legend: 解释三段式 */
.legend{max-width:780px;margin:14px auto 0;text-align:center;font-size:13px;color:var(--ink3)}
.legend span{display:inline-block;margin:0 9px}
.legend i{font-style:normal;font-weight:600}
.legend .l1 i{color:var(--ink)}.legend .l2 i{color:var(--blue-d)}.legend .l3 i{color:var(--amber)}

/* Sticky filter */
.bar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.82);
  backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
  border-bottom:1px solid var(--line);margin-top:52px}
.bar .inner{max-width:var(--max);margin:0 auto;padding:13px 22px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.segs{display:flex;gap:6px;flex-wrap:wrap}
.seg{border:none;background:transparent;color:var(--ink2);font-size:14px;font-weight:500;
  padding:7px 15px;border-radius:999px;cursor:pointer;transition:.18s;font-family:inherit;white-space:nowrap}
.seg:hover{background:var(--bg2);color:var(--ink)}
.seg.on{background:var(--ink);color:#fff}
.seg .c{opacity:.55;margin-left:5px;font-size:12px}.seg.on .c{opacity:.7}
.spacer{flex:1 1 30px}
.sort{border:1px solid var(--line);background:var(--card);border-radius:999px;color:var(--ink);
  font-size:13.5px;padding:7px 14px;font-family:inherit;cursor:pointer;outline:none}
.search{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 16px;
  font-size:14px;font-family:inherit;color:var(--ink);outline:none;min-width:180px;transition:.18s}
.search::placeholder{color:var(--ink3)}
.search:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(0,113,227,.12)}

/* Grid */
.count{max-width:var(--max);margin:28px auto 0;padding:0 22px;font-size:14px;color:var(--ink3)}
.grid{max-width:var(--max);margin:14px auto 0;padding:0 22px 110px;
  display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:24px 24px 20px;display:flex;flex-direction:column;transition:.2s}
.card:hover{box-shadow:0 12px 36px rgba(0,0,0,.09);transform:translateY(-3px);border-color:#d8d8dc}
.chead{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.rank{font-size:12px;font-weight:600;color:var(--ink3);font-variant-numeric:tabular-nums}
.pill{font-size:11.5px;font-weight:600;color:var(--blue-d);background:#eef5fd;padding:3px 10px;border-radius:999px}
.nm{font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--ink);margin:0;line-height:1.3}
.nm a{color:inherit}.nm a:hover{color:var(--blue)}
.row{margin-top:13px}
.row .lab{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-bottom:5px;letter-spacing:.02em}
.row.r1 .lab{color:#1d1d1f;background:#ececee}
.row.r2 .lab{color:var(--blue-d);background:#e7f1fc}
.row.r3 .lab{color:#9a5b00;background:#fff2dc}
.row .txt{font-size:14px;color:#33363b;line-height:1.55;margin:0}
.foot{display:flex;align-items:center;gap:15px;margin-top:18px;padding-top:15px;border-top:1px solid var(--line);
  font-size:12.5px;color:var(--ink3);font-variant-numeric:tabular-nums}
.lang{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:500}
.dot{width:9px;height:9px;border-radius:50%;background:var(--blue)}
.gh{margin-left:auto;color:var(--blue);font-weight:500}.gh:hover{text-decoration:underline}
.empty{grid-column:1/-1;text-align:center;color:var(--ink3);padding:60px 0;font-size:15px}
.pagefoot{text-align:center;color:var(--ink3);font-size:12.5px;padding:0 22px 70px;line-height:1.9}
.hidden{display:none}
</style></head>
<body>

<div class="wrap">
  <div class="hero">
    <p class="kicker">AI 生态项目雷达</p>
    <h1>不懂技术，<br>也能看懂的 AI 项目精选。</h1>
    <p class="sub">每天从全网筛出值得关注的 AI 项目，并用大白话讲清楚：它是什么、你能拿它做什么、为什么对你重要。</p>
    <p class="metaline">本期 <b id="mDate"></b> · 精选 <b id="mTotal"></b> 个 · 当天扫描 <b id="mScan"></b> 个仓库</p>

    <div class="how">
      <div class="it"><div class="n">1</div><div class="t"><b>选个分类</b>按「做东西 / 帮写代码 / 省钱提效…」找你关心的方向</div></div>
      <div class="it"><div class="n">2</div><div class="t"><b>读三句话</b>每个项目都讲清是什么、能帮你干啥、为何值得看</div></div>
      <div class="it"><div class="n">3</div><div class="t"><b>感兴趣点进去</b>点卡片底部「GitHub」直达项目主页</div></div>
    </div>
    <div class="legend">
      <span class="l1"><i>● 是什么</i> 一句话本质</span>
      <span class="l2"><i>● 你能做什么</i> 具体用途</span>
      <span class="l3"><i>● 为什么重要</i> 对你的价值</span>
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
  数据源：本仓库 digests/<span id="dt"></span> · 小白文案由「读 README + 大模型翻译」生成<br>
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

const catCount={};
D.projects.forEach(p=>{catCount[p.cat]=(catCount[p.cat]||0)+1;});
const cats=['全部',...Object.keys(catCount).sort((a,b)=>catCount[b]-catCount[a])];
document.getElementById('segs').innerHTML=cats.map((c,i)=>{
  const n=c==='全部'?D.total:catCount[c];
  return '<button class="seg'+(i===0?' on':'')+'" data-c="'+esc(c)+'">'+esc(c)+'<span class="c">'+n+'</span></button>';
}).join('');

function card(p,i){
  const r=(cls,lab,txt)=>txt?'<div class="row '+cls+'"><span class="lab">'+lab+'</span><p class="txt">'+esc(txt)+'</p></div>':'';
  return '<article class="card">'
    +'<div class="chead"><span class="rank">#'+(i+1)+'</span><span class="pill">'+esc(p.cat)+'</span></div>'
    +'<h2 class="nm"><a href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(p.name)+'</a></h2>'
    +r('r1','是什么',p.whatIs)
    +r('r2','你能用它做什么',p.forYou)
    +r('r3','为什么对你重要',p.whyMatters)
    +'<div class="foot"><span class="lang"><span class="dot"></span>'+esc(p.lang)+'</span>'
    +'<span>★ '+fmt(p.stars)+'</span><span>⑂ '+fmt(p.forks)+'</span>'
    +'<a class="gh" href="'+esc(p.url)+'" target="_blank" rel="noopener">GitHub ↗</a></div>'
    +'</article>';
}

function render(){
  let list=D.projects.filter(p=>state.cat==='全部'||p.cat===state.cat);
  if(state.q){const q=state.q.toLowerCase();
    list=list.filter(p=>(p.name+' '+p.whatIs+' '+p.forYou+' '+p.whyMatters+' '+p.cat).toLowerCase().includes(q));}
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
console.log(`[radar] 已生成 radar.html（来源 ${latest.date}，${projects.length} 个项目，${enriched.length} 个含小白文案）`);
