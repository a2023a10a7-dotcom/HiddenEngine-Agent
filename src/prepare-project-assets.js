import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId=process.env.PROJECT_ID;
const apiKey=process.env.PIXABAY_API_KEY;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("PROJECT_ID missing or invalid");
if(!apiKey) throw new Error("PIXABAY_API_KEY is required");
const root=path.join("production","projects",projectId);
const out=path.join("dist",projectId);
const stop=new Set(["with","from","that","this","into","over","under","china","modern","technology"]);
function terms(s){return String(s||"").toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x));}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let lastPixabayRequest=0;
async function fetchJson(url){
 let lastError;
 for(let attempt=0;attempt<7;attempt++){
  const pause=Math.max(0,1400-(Date.now()-lastPixabayRequest));
  if(pause) await sleep(pause);
  lastPixabayRequest=Date.now();
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(60000)});
   if(r.ok) return r.json();
   const detail=await r.text();
   if(r.status!==429&&r.status<500) throw new Error("Pixabay API failed ("+r.status+"): "+detail.slice(0,300));
   lastError=new Error("Pixabay API HTTP "+r.status+": "+detail.slice(0,200));
   const retryAfter=Number(r.headers.get("retry-after"))*1000;
   const backoff=Number.isFinite(retryAfter)&&retryAfter>0?retryAfter:Math.min(60000,3000*Math.pow(2,attempt));
   console.warn("Pixabay API rate limited or unavailable ("+r.status+"); retrying in "+backoff+"ms.");
   await sleep(backoff);
  }catch(error){
   lastError=error;
   if(attempt===6) break;
   const backoff=Math.min(60000,3000*Math.pow(2,attempt));
   console.warn("Pixabay API request failed: "+error.message+"; retrying in "+backoff+"ms.");
   await sleep(backoff);
  }
 }
 throw new Error("Pixabay API request failed after extended retries: "+(lastError?.message||"unknown error"));
}
let lastImageDownload=0;
async function download(url,file){
 let lastError;
 for(let attempt=0;attempt<7;attempt++){
  const pause=Math.max(0,1200-(Date.now()-lastImageDownload));
  if(pause) await sleep(pause);
  lastImageDownload=Date.now();
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(45000)});
   if(r.ok){
    const b=Buffer.from(await r.arrayBuffer());
    if(b.length<4096||b.length>25*1024*1024) throw new Error("Preview image size is invalid ("+b.length+" bytes)");
    await writeFile(file,b);return;
   }
   const detail=await r.text();
   if(r.status!==429&&r.status<500) throw new Error("Preview download failed ("+r.status+"): "+detail.slice(0,200));
   lastError=new Error("HTTP "+r.status+": "+detail.slice(0,120));
   const retryAfter=Number(r.headers.get("retry-after"))*1000;
   const backoff=Number.isFinite(retryAfter)&&retryAfter>0?retryAfter:Math.min(60000,5000*Math.pow(2,attempt));
   console.warn("Pixabay image download rate limited ("+r.status+"); retrying in "+backoff+"ms.");
   await sleep(backoff);
  }catch(e){lastError=e;if(attempt===6)break;await sleep(Math.min(30000,3000*Math.pow(2,attempt)));}
 }
 throw new Error("Preview download failed after extended retries: "+(lastError?.message||"unknown error"));
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
async function main(){
 const script=JSON.parse(await readFile(path.join(root,"script.json"),"utf8"));
 await mkdir(out,{recursive:true});
 const assets=[],selection=[],seen=new Set(),sheetItems=[];
 for(let i=0;i<script.scenes.length;i++){
  const scene=script.scenes[i],queries=(scene.visual_queries||[]).slice(0,5),requirements=scene.visual_requirements||[];
  const candidates=[];
  for(const query of queries){
   const u=new URL("https://pixabay.com/api/");
   u.searchParams.set("key",apiKey);u.searchParams.set("q",query);u.searchParams.set("image_type","photo");
   u.searchParams.set("orientation","horizontal");u.searchParams.set("safesearch","true");u.searchParams.set("per_page","50");
   const data=await fetchJson(u);
   for(const hit of data.hits||[]){
    if(!hit.largeImageURL||!hit.webformatURL||!hit.pageURL||seen.has(hit.id)) continue;
    if((hit.imageWidth||0)<1280||(hit.imageHeight||0)<720) continue;
    const tags=String(hit.tags||"").toLowerCase(),tokens=terms(query);
    const groupHits=requirements.map(group=>group.filter(term=>tags.includes(term.toLowerCase())).length);
    if(requirements.length && (scene.requireAllVisualGroups ? !groupHits.every(n=>n>0) : !groupHits.some(n=>n>0))) continue;
    const score=tokens.reduce((n,t)=>n+(tags.includes(t)?(t.length>5?3:1):0),0)+groupHits.reduce((a,b)=>a+b,0)*6;
    if(score<4) continue;
    candidates.push({hit,query,score});
   }
  }
  candidates.sort((a,b)=>b.score-a.score || (b.hit.imageWidth*b.hit.imageHeight)-(a.hit.imageWidth*a.hit.imageHeight));
  const chosen=[];
  for(const c of candidates){if(chosen.length>=12) break;if(c.score<4) continue;seen.add(c.hit.id);chosen.push(c);}
  if(chosen.length<12) throw new Error("Only "+chosen.length+" relevant high-resolution images found for scene "+(i+1)+" ("+scene.title+"). Need 12 specific visuals to keep each shot under six seconds; refusing irrelevant stock.");
  const ids=[];
  for(let n=0;n<chosen.length;n++){
   const c=chosen[n],h=c.hit,id="S"+String(i+1).padStart(2,"0")+"-I"+(n+1);
   const preview=path.join(out,id+".jpg");
   try{await download(h.webformatURL,preview);}catch(primaryError){
    console.warn(id+": web preview throttled; trying original image URL. "+primaryError.message);
    await download(h.largeImageURL,preview);
   }
   const item={id,scene:i+1,creator:h.user||"Pixabay contributor",tags:h.tags||"",width:h.imageWidth,height:h.imageHeight,
    sourcePage:h.pageURL,previewFile:id+".jpg",largeImageURL:h.largeImageURL,license:"Pixabay Content License",
    licenseUrl:"https://pixabay.com/service/license-summary/",searchQuery:c.query,relevanceScore:c.score};
   assets.push(item);ids.push(id);sheetItems.push({id,scene:i+1,tags:item.tags,file:preview});
  }
  selection.push({scene:i+1,title:scene.title,selectedImageIds:ids});
  console.log("Scene "+(i+1)+": selected "+ids.join(", ")+ "; matched terms and minimum 1280x720.");
 }
 await writeFile(path.join(root,"visual-selection.json"),JSON.stringify({projectId,title:script.title,source:"Automated semantic match against Pixabay tags; twelve high-resolution images per scene, with at least one scene-specific tag group match",scenes:selection},null,2)+"\n");
 await writeFile(path.join(root,"visual-assets.json"),JSON.stringify({projectId,source:"Pixabay API search; relevance-scored against scene-specific queries",assetCount:assets.length,assets},null,2)+"\n");
 const cols=5,cellW=320,cellH=180,labelH=48,gap=10,margin=10,rows=Math.ceil(sheetItems.length/cols);
 const parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+(margin*2+cols*cellW+(cols-1)*gap)+'" height="'+(margin*2+rows*(cellH+labelH)+(rows-1)*gap)+'">','<rect width="100%" height="100%" fill="#090b0e"/>'];
 for(let i=0;i<sheetItems.length;i++){
  const x=margin+(i%cols)*(cellW+gap),y=margin+Math.floor(i/cols)*(cellH+labelH+gap),item=sheetItems[i];
  const data=(await readFile(item.file)).toString("base64");
  parts.push('<rect x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+(cellH+labelH)+'" fill="#171a1e"/>');
  parts.push('<image x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+cellH+'" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,'+data+'"/>');
  parts.push('<text x="'+(x+12)+'" y="'+(y+cellH+23)+'" fill="#f0ede5" font-family="DejaVu Sans" font-size="16" font-weight="bold">'+esc(item.id)+' • SCENE '+item.scene+'</text>');
  parts.push('<text x="'+(x+12)+'" y="'+(y+cellH+44)+'" fill="#bdb6aa" font-family="DejaVu Sans" font-size="11">'+esc(item.tags.slice(0,72))+'</text>');
 }
 parts.push("</svg>");
 const svg=path.join(out,"contact-sheet.svg");
 await writeFile(svg,parts.join(""));
 await new Promise((resolve,reject)=>{const p=spawn("rsvg-convert",["-f","png","-o",path.join(out,"contact-sheet.png"),svg],{stdio:"inherit"});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error("rsvg-convert failed")));});
 await new Promise((resolve,reject)=>{const p=spawn("ffmpeg",["-y","-i",path.join(out,"contact-sheet.png"),"-frames:v","1","-q:v","2",path.join(out,"contact-sheet.jpg")],{stdio:"inherit"});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error("contact sheet JPEG failed")));});
 console.log("Prepared "+assets.length+" relevance-scored scene images and contact sheet.");
}
main().catch(e=>{console.error(e);process.exit(1);});
