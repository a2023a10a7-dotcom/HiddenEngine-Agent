import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId=process.env.PROJECT_ID;
const apiKey=process.env.PIXABAY_API_KEY;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("PROJECT_ID missing or invalid");
if(!apiKey) throw new Error("PIXABAY_API_KEY is required");
const root=path.join("production","projects",projectId);
const out=path.join("dist",projectId);
const stop=new Set(["with","from","that","this","into","over","under","china","modern","technology","factory","industrial","manufacturing","production","assembly","workers","equipment","plant","market","product","line","system","business","city","global","aerial","advanced","company","industry","facility","machine","machines","process"]);
const synonyms={
 automated:["automation","robotic","robot"],automation:["automated","robotic","robot"],robotics:["robotic","robot"],robot:["robotic","robotics"],
 drone:["quadcopter","uav"],quadcopter:["drone","uav"],uav:["drone","quadcopter"],
 semiconductor:["chip","microchip","wafer"],microchip:["chip","semiconductor"],chip:["microchip","semiconductor"],
 laboratory:["lab","research"],researcher:["scientist","research"],scientist:["researcher","laboratory"],
 battery:["cell","lithium"],lithium:["battery","cell"],photovoltaic:["solar","solar panel"],solar:["photovoltaic","solar panel"],
 train:["railway","bullet train"],railway:["train","bullet train"]
};
function terms(s){return String(s||"").toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x));}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function relevance(query, excerpt, requirements=[]){
 const q=terms(query), e=new Set(terms(excerpt));
 const overlap=q.filter(t=>e.has(t)||[...(synonyms[t]||[])].some(s=>e.has(s)));
 const groups=requirements.map(group=>(Array.isArray(group)?group:[]).some(term=>{
  const ts=terms(term); return ts.some(t=>e.has(t)||[...(synonyms[t]||[])].some(s=>e.has(s)));
 }));
 return {score:overlap.reduce((n,t)=>n+(t.length>5?4:2),0)+groups.filter(Boolean).length*3,overlap,groups};
}
async function planNarrationShots(scene){
 const narration=String(scene.narration||"").trim();
 if(!narration) throw new Error("Scene has no narration for visual planning: "+scene.title);
 const queries=Array.isArray(scene.visual_queries)?scene.visual_queries.map(x=>String(x).trim()).filter(Boolean):[];
 if(!queries.length) throw new Error("Scene has no approved visual_queries: "+scene.title);
 const sentences=(narration.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[narration]).map(s=>s.trim()).filter(Boolean);
 const shots=[]; let chunk=[],count=0;
 for(const sentence of sentences){
  const n=sentence.split(/\s+/).length;
  if(chunk.length && count+n>22){shots.push(chunk.join(" "));chunk=[];count=0;}
  chunk.push(sentence);count+=n;
 }
 if(chunk.length) shots.push(chunk.join(" "));
 return shots.map((excerpt,i)=>{
  const ranked=queries.map(query=>({query,...relevance(query,excerpt,scene.visual_requirements||[])})).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  const excerptTerms=terms(excerpt).filter(t=>!stop.has(t)).slice(0,5);
  const query=[...excerptTerms,best.query].filter(Boolean).join(" ");
  return {shot:i+1,narrationExcerpt:excerpt,visualQuery:query,approvedVisualQuery:best.query,visualType:"narration_matched",reason:"Shot boundaries follow sentence meaning; query is selected by overlap with the actual narration and scene requirements.",targetDurationSeconds:Math.max(3,Math.min(8,count/2.5))};
 });
}
async function searchPixabayVideo(query, excerpt, requirements=[]){
 const u=new URL("https://pixabay.com/api/videos/");
 u.searchParams.set("key",apiKey);u.searchParams.set("q",query);
 u.searchParams.set("safesearch","true");u.searchParams.set("per_page","50");
 const data=await fetchJson(u);
 return (data.hits||[]).filter(hit=>hit.pageURL&&!seenVideoIds.has(hit.id)&&hit.videos)
  .map(hit=>{
   const variants=Object.values(hit.videos||{}).filter(v=>v&&v.url&&v.width>=1280&&v.height>=720);
   const file=variants.sort((a,b)=>(b.width*b.height)-(a.width*a.height))[0];
   const match=relevance(query+" "+(hit.tags||""),excerpt,requirements);
   return {hit,file,score:match.score,matched:match.overlap};
  }).filter(x=>x.file&&Number(x.hit.duration||0)>=5&&x.matched.length>0)
  .sort((a,b)=>b.score-a.score||(b.file.width*b.file.height)-(a.file.width*a.file.height))[0]||null;
}

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

 const assets=[],selection=[],seen=new Set(),seenVideoIds=new Set(),sheetItems=[];
 for(let i=0;i<script.scenes.length;i++){
  const scene=script.scenes[i];
  const plannedShots=await planNarrationShots(scene);
  const selectedShots=[];
  for(const shot of plannedShots){
   const requirementGroups=Array.isArray(scene.visual_requirements)?scene.visual_requirements:[];
   const queryOptions=[shot.visualQuery,...(Array.isArray(scene.visual_queries)?scene.visual_queries:[]).map(q=>String(q).trim()).filter(q=>q&&q!==shot.visualQuery)];
   let chosen=null,selectedQuery=shot.visualQuery;
   const videoQueryOptions=[shot.visualQuery,shot.approvedVisualQuery,...queryOptions].filter((q,index,all)=>q&&all.indexOf(q)===index);
   let selectedVideo=null,selectedVideoQuery=shot.visualQuery;
   for(const query of videoQueryOptions){
    try{
     const candidate=await searchPixabayVideo(query,shot.narrationExcerpt,requirementGroups);
     if(candidate){selectedVideo=candidate;selectedVideoQuery=query;break;}
    }catch(error){console.warn("Pixabay video search unavailable for "+query+": "+error.message);}
   }
   if(selectedVideo){
    const h=selectedVideo.hit,v=selectedVideo.file,id="S"+String(i+1).padStart(2,"0")+"-SH"+String(shot.shot).padStart(3,"0");
    seenVideoIds.add(h.id);
    const thumbnail=h.videos?.medium?.thumbnail||h.videos?.large?.thumbnail||h.videos?.small?.thumbnail;
    let preview=path.join(out,id+".jpg");
    if(thumbnail){try{await download(thumbnail,preview);}catch(e){console.warn("Video thumbnail unavailable for "+id+": "+e.message);preview=null;}}
    const item={id,scene:i+1,shot:shot.shot,mediaType:"video",creator:h.user||"Pixabay contributor",tags:h.tags||"",width:v.width,height:v.height,duration:h.duration,
     sourcePage:h.pageURL,previewFile:preview?path.basename(preview):null,videoUrl:v.url,license:"Pixabay Content License",licenseUrl:"https://pixabay.com/service/license-summary/",
     searchQuery:selectedVideoQuery,originalSearchQuery:shot.visualQuery,usedFallbackQuery:selectedVideoQuery!==shot.visualQuery,relevanceScore:selectedVideo.score,matchedQueryTerms:selectedVideo.matched,
     narrationExcerpt:shot.narrationExcerpt,visualReason:"Real stock video selected against the narration excerpt and scene requirements; illustrative footage, never presented as proof of a specific event."};
    assets.push(item);if(preview)sheetItems.push({id,scene:i+1,tags:item.tags,file:preview});
    selectedShots.push({...shot,visualQuery:selectedVideoQuery,mediaType:"video",originalVisualQuery:shot.visualQuery,imageId:id,relevanceScore:selectedVideo.score,matchedQueryTerms:selectedVideo.matched});
    continue;
   }
   for(const query of queryOptions){
    const u=new URL("https://pixabay.com/api/");
    u.searchParams.set("key",apiKey);u.searchParams.set("q",query);
    u.searchParams.set("image_type","photo");u.searchParams.set("orientation","horizontal");
    u.searchParams.set("safesearch","true");u.searchParams.set("per_page","50");
    const data=await fetchJson(u);
    const tokens=terms(query);
    const candidates=(data.hits||[]).filter(hit=>hit.largeImageURL&&hit.webformatURL&&hit.pageURL&&!seen.has(hit.id)
      &&(hit.imageWidth||0)>=1280&&(hit.imageHeight||0)>=720).map(hit=>{
       const tags=String(hit.tags||"").toLowerCase();
       const queryMatches=tokens.filter(t=>[t,...(synonyms[t]||[])].some(term=>tags.includes(term)));
       const groupMatches=requirementGroups.map(group=>(Array.isArray(group)?group:[]).some(term=>{
        const value=String(term||"").toLowerCase();
        return value&&(tags.includes(value)||terms(value).some(t=>[t,...(synonyms[t]||[])].some(term=>tags.includes(term))));
       }));
       const score=queryMatches.reduce((n,t)=>n+(t.length>5?5:3),0)+groupMatches.filter(Boolean).length*2;
       return {hit,score,queryMatches,groupMatches};
      }).filter(x=>x.queryMatches.length>=1&&(!scene.requireAllVisualGroups||x.groupMatches.every(Boolean)))
      .sort((a,b)=>b.score-a.score||(b.hit.imageWidth*b.hit.imageHeight)-(a.hit.imageWidth*a.hit.imageHeight));
    if(candidates.length){chosen=candidates[0];selectedQuery=query;break;}
   }
   if(!chosen) throw new Error("No relevant 1280x720+ Pixabay image for scene "+(i+1)+" shot "+shot.shot+" after trying "+queryOptions.length+" scene queries. Original query: "+shot.visualQuery);
   const h=chosen.hit,id="S"+String(i+1).padStart(2,"0")+"-SH"+String(shot.shot).padStart(3,"0");
   seen.add(h.id);
   const preview=path.join(out,id+".jpg");
   try{await download(h.webformatURL,preview);}catch(primaryError){
    console.warn(id+": preview download failed; trying original. "+primaryError.message);
    await download(h.largeImageURL,preview);
   }
   const item={id,scene:i+1,shot:shot.shot,mediaType:"image",creator:h.user||"Pixabay contributor",tags:h.tags||"",
    width:h.imageWidth,height:h.imageHeight,sourcePage:h.pageURL,previewFile:id+".jpg",
    largeImageURL:h.largeImageURL,license:"Pixabay Content License",licenseUrl:"https://pixabay.com/service/license-summary/",
    searchQuery:selectedQuery,originalSearchQuery:shot.visualQuery,usedFallbackQuery:selectedQuery!==shot.visualQuery,relevanceScore:chosen.score,matchedQueryTerms:chosen.queryMatches,matchedVisualRequirementGroups:chosen.groupMatches.map((matched,index)=>matched?index+1:null).filter(Boolean),narrationExcerpt:shot.narrationExcerpt,visualReason:shot.reason};
   assets.push(item);sheetItems.push({id,scene:i+1,tags:item.tags,file:preview});
   selectedShots.push({...shot,visualQuery:selectedQuery,originalVisualQuery:shot.visualQuery,usedFallbackQuery:selectedQuery!==shot.visualQuery,imageId:id,relevanceScore:chosen.score,matchedQueryTerms:chosen.queryMatches});
  }
  selection.push({scene:i+1,title:scene.title,selectedImageIds:selectedShots.map(x=>x.imageId),shots:selectedShots});
  console.log("Scene "+(i+1)+": AI planned "+selectedShots.length+" narration-matched shots; target ~5 seconds each.");
 }
 const selectionManifest={projectId,title:script.title,source:"Narration is segmented at sentence boundaries into short semantic shots; each query is ranked against its actual excerpt and scene requirements. Pixabay video is preferred when a relevant 720p+ clip exists; unique still imagery is the fallback.",scenes:selection};
 const assetManifest={projectId,source:"Pixabay API video and image search; assets are selected against narration excerpts and scene requirements, with source and license metadata retained.",assetCount:assets.length,uniqueAssetCount:new Set(assets.map(asset=>asset.sourcePage)).size,assets};
 await writeFile(path.join(root,"visual-selection.json"),JSON.stringify(selectionManifest,null,2)+"\n");
 await writeFile(path.join(root,"visual-assets.json"),JSON.stringify(assetManifest,null,2)+"\n");
 await writeFile(path.join(out,"visual-selection.json"),JSON.stringify(selectionManifest,null,2)+"\n");
 await writeFile(path.join(out,"visual-assets.json"),JSON.stringify(assetManifest,null,2)+"\n");
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
 const uniqueAssetCount=new Set(assets.map(asset=>asset.sourcePage)).size;
 if(uniqueAssetCount!==assets.length) throw new Error("Visual selection contains duplicate source pages: "+uniqueAssetCount+"/"+assets.length);
 console.log("Prepared "+assets.length+" unique narration-matched visuals ("+assets.filter(x=>x.mediaType==="video").length+" video clips, "+assets.filter(x=>x.mediaType==="image").length+" stills) and contact sheet.");
}
main().catch(e=>{console.error(e);process.exit(1);});
