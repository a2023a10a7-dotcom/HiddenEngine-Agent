import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = "dist/visual-relevance-audit";
const UA = "HiddenEngineVisualAudit/1.0";
const QUERIES = [
  "AI research laboratory",
  "data center server racks",
  "software engineer coding",
  "semiconductor chip",
  "industrial automation robotics",
  "computer neural network visualization"
];
const stop = new Set(["the","and","for","with","from","into","about","image","video","photo","footage","computer"]);
const terms = q => [...new Set(String(q).toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(x=>!stop.has(x));
function score(query, tags) {
  const wanted=terms(query), available=String(tags||"").toLowerCase().match(/[a-z0-9]+/g)||[];
  const matched=wanted.filter(t=>available.some(x=>x===t||(t.length>=5&&x.includes(t))||(x.length>=5&&t.includes(x))));
  return {score:wanted.length?Number((matched.length/wanted.length).toFixed(2)):0,matched,terms:wanted};
}
async function get(url, headers={}) {
  const c=new AbortController(), timer=setTimeout(()=>c.abort(),20000);
  try { const r=await fetch(url,{headers,signal:c.signal}); if(!r.ok) throw new Error("HTTP "+r.status); return r; }
  finally { clearTimeout(timer); }
}
async function save(url,name) {
  const r=await get(url,{"User-Agent":UA});
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.length<512) throw new Error("sample too small");
  const type=r.headers.get("content-type")||"unknown";
  const ext=/mp4/i.test(type)||/\.mp4(?:$|\?)/i.test(url)?"mp4":/png/i.test(type)?"png":/webp/i.test(type)?"webp":"jpg";
  const file=path.join(OUT,name+"."+ext); await writeFile(file,bytes);
  return {sample:file,bytes:bytes.length,contentType:type};
}
async function pixabay(query,kind) {
  const key=process.env.PIXABAY_API_KEY; if(!key) throw new Error("PIXABAY_API_KEY missing");
  const video=kind==="video", base=video?"https://pixabay.com/api/videos/":"https://pixabay.com/api/";
  const u=new URL(base); u.search=new URLSearchParams({key,q:query,safesearch:"true",per_page:"20",...(video?{}:{image_type:"photo",orientation:"horizontal"})});
  const data=await (await get(u)).json(), hits=data.hits||[];
  const ranked=hits.map(h=>({h,...score(query,h.tags)})).sort((a,b)=>b.score-a.score);
  const good=ranked.filter(x=>x.score>=0.25);
  let sample=null;
  if(good[0]) {
    const h=good[0].h, url=video?(Object.values(h.videos||{}).filter(v=>v?.url).sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url):(h.largeImageURL||h.webformatURL);
    if(url) sample=await save(url,"pixabay-"+kind+"-"+QUERIES.indexOf(query));
  }
  return {source:"Pixabay "+kind,query,total:hits.length,relevant:good.length,best:good[0]?{score:good[0].score,matched:good[0].matched,page:good[0].h.pageURL,creator:good[0].h.user,license:"Pixabay Content License"}:null,...(sample||{})};
}
async function nasa(query,kind) {
  const mediaType=kind==="video"?"video":"image";
  const u="https://images-api.nasa.gov/search?"+new URLSearchParams({q:query,media_type:mediaType,page_size:"20"});
  const items=(await (await get(u,{"User-Agent":UA})).json()).collection?.items||[];
  const ranked=items.map(x=>{const d=x.data?.[0]||{};return {x,d,...score(query,[d.title,d.description,d.keywords].flat().join(" "))};}).sort((a,b)=>b.score-a.score);
  const good=ranked.filter(x=>x.score>=0.25); let sample=null;
  if(good[0]) {
    const d=good[0].d;
    let url=good[0].x.links?.find(l=>l.rel==="preview")?.href;
    if(mediaType==="video"&&d.nasa_id) {
      const files=await (await get("https://images-api.nasa.gov/asset/"+encodeURIComponent(d.nasa_id),{"User-Agent":UA})).json();
      const entries=Array.isArray(files)?files:(files.collection?.items||[]);
      url=entries.find(x=>typeof x==="string"&&/\.mp4(?:$|\?)/i.test(x))||entries.find(x=>x?.href&&/\.mp4(?:$|\?)/i.test(x.href))?.href;
    }
    if(url) sample=await save(url,"nasa-"+kind+"-"+QUERIES.indexOf(query));
  }
  return {source:"NASA "+kind,query,total:items.length,relevant:good.length,best:good[0]?{score:good[0].score,matched:good[0].matched,title:good[0].d.title,page:"https://images.nasa.gov/details/"+good[0].d.nasa_id,creator:good[0].d.center,license:"NASA media usage guidelines"}:null,...(sample||{})};
}
async function openverse(query) {
  const u="https://api.openverse.org/v1/images/?"+new URLSearchParams({q:query,license:"cc0,pdm,by,by-sa",aspect_ratio:"wide",page_size:"20"});
  const items=(await (await get(u,{"User-Agent":UA})).json()).results||[];
  const ranked=items.map(x=>({x,...score(query,[x.title,x.tags?.map(t=>t.name).join(" "),x.description].join(" "))})).sort((a,b)=>b.score-a.score);
  const good=ranked.filter(x=>x.score>=0.25); let sample=null;
  if(good[0]) sample=await save(good[0].x.thumbnail||good[0].x.url,"openverse-"+QUERIES.indexOf(query));
  return {source:"Openverse image",query,total:items.length,relevant:good.length,best:good[0]?{score:good[0].score,matched:good[0].matched,title:good[0].x.title,page:good[0].x.foreign_landing_url,creator:good[0].x.creator,license:good[0].x.license,licenseUrl:good[0].x.license_url}:null,...(sample||{})};
}
async function commons(query) {
  const u="https://commons.wikimedia.org/w/api.php?"+new URLSearchParams({action:"query",list:"search",srnamespace:"6",srlimit:"20",srsearch:query,format:"json"});
  const items=(await (await get(u,{"User-Agent":UA})).json()).query?.search||[];
  const titles=items.map(x=>x.title), result=[];
  if(titles.length) {
    const d="https://commons.wikimedia.org/w/api.php?"+new URLSearchParams({action:"query",titles:titles.join("|"),prop:"imageinfo",iiprop:"url|mime|extmetadata",iiurlwidth:"1280",format:"json"});
    const pages=Object.values((await (await get(d,{"User-Agent":UA})).json()).query?.pages||{});
    for(const p of pages) { const info=p.imageinfo?.[0]; if(!info||!/^image\/(jpeg|png|webp)$/i.test(info.mime||"")) continue;
      const meta=info.extmetadata||{}, clean=v=>String(v?.value||"").replace(/<[^>]*>/g,"").trim();
      const title=p.title.replace(/^File:/,""), s=score(query,title+" "+clean(meta.ImageDescription));
      result.push({title,info,meta,clean, ...s});
    }
  }
  result.sort((a,b)=>b.score-a.score); const good=result.filter(x=>x.score>=0.25); let sample=null;
  if(good[0]) sample=await save(good[0].info.thumburl||good[0].info.url,"commons-"+QUERIES.indexOf(query));
  const b=good[0];
  return {source:"Wikimedia Commons image",query,total:items.length,relevant:good.length,best:b?{score:b.score,matched:b.matched,title:b.title,page:b.info.descriptionurl,creator:b.clean(b.meta.Artist)||"Not supplied",license:b.clean(b.meta.LicenseShortName)||"Not supplied",licenseUrl:b.meta.LicenseUrl?.value||""}:null,...(sample||{})};
}
await mkdir(OUT,{recursive:true});
const results=[];
for(const query of QUERIES) {
  for(const [name,fn] of [["Pixabay image",()=>pixabay(query,"image")],["Pixabay video",()=>pixabay(query,"video")],["NASA image",()=>nasa(query,"image")],["NASA video",()=>nasa(query,"video")],["Wikimedia Commons image",()=>commons(query)],["Openverse image",()=>openverse(query)]]) {
    try { results.push(await fn()); }
    catch(e) { results.push({source:name,query,error:String(e.message||e)}); }
  }
}
const summary={testedAt:new Date().toISOString(),topic:"Illustrative visuals for the documentary about AI development automation and Anthropic's August 2026 report",threshold:0.25,queries:QUERIES,results};
await writeFile(path.join(OUT,"report.json"),JSON.stringify(summary,null,2));
console.log(JSON.stringify({testedAt:summary.testedAt,counts:Object.fromEntries([...new Set(results.map(x=>x.source))].map(s=>[s,{queries:results.filter(x=>x.source===s).length,withRelevant:results.filter(x=>x.source===s&&x.relevant>0).length,errors:results.filter(x=>x.source===s&&x.error).length}])),results},null,2));
