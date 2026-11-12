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
const rules={
 1:{groups:[["factory","assembly","automotive","industrial","manufacturing","robotic"],["car","vehicle","conveyor","welding"]],ban:["scanner","laser","temple","package","cardboard","warehouse","logistics"]},
 2:{groups:[["electric"],["car","vehicle","automobile"]],ban:["sign","symbol","pavement","wallpaper","road marking","logo","illustration"]},
 3:{groups:[["battery","lithium","cell"],["factory","manufacturing","production","electrode","assembly"]],ban:["car","charging station","mobility","sign","pavement"]},
 4:{groups:[["robot","robotic","automation"],["arm","industrial","factory","welding","manufacturing"]],ban:["toy","dice","book","animation","simulation","game","illustration"]},
 5:{groups:[["solar"],["panel","photovoltaic","farm","module","wafer"]],ban:["logo","sign","illustration","wallpaper"]},
 6:{groups:[["chip","microchip","semiconductor","wafer"],["circuit","processor","silicon","electronics"]],ban:["logo","sign","illustration","wallpaper"]},
 7:{groups:[["port","ship","container","cargo","crane"],["harbor","shipping","freight","terminal","vessel"]],ban:["logo","sign","illustration","wallpaper"]}
};
function terms(s){return String(s||"").toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x));}
async function fetchJson(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
 if(!r.ok) throw new Error("Pixabay API failed ("+r.status+")");
 return r.json();
}
async function download(url,file){
 const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!r.ok) throw new Error("Preview download failed ("+r.status+")");
 const b=Buffer.from(await r.arrayBuffer());
 if(b.length<10000||b.length>12*1024*1024) throw new Error("Preview image size is invalid");
 await writeFile(file,b);
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
async function main(){
 const script=JSON.parse(await readFile(path.join(root,"script.json"),"utf8"));
 await mkdir(out,{recursive:true});
 const assets=[],selection=[],seen=new Set(),sheetItems=[];
 for(let i=0;i<script.scenes.length;i++){
  const scene=script.scenes[i],queries=(scene.visual_queries||[]).slice(0,3);
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
    const rule=rules[i+1];
    const banned=rule.ban.some(term=>tags.includes(term));
    const groupHits=rule.groups.map(group=>group.filter(term=>tags.includes(term)).length);
    if(banned||groupHits.some(n=>n===0)) continue;
    const score=tokens.reduce((n,t)=>n+(tags.includes(t)?(t.length>5?3:1):0),0)+groupHits.reduce((a,b)=>a+b,0)*4;
    if(score<12) continue;
    candidates.push({hit,query,score});
   }
  }
  candidates.sort((a,b)=>b.score-a.score || (b.hit.imageWidth*b.hit.imageHeight)-(a.hit.imageWidth*a.hit.imageHeight));
  const chosen=[];
  for(const c of candidates){
   if(chosen.length>=2) break;
   if(c.score<12) continue;
   seen.add(c.hit.id);chosen.push(c);
  }
  if(chosen.length<2) throw new Error("Only "+chosen.length+" strictly matched high-resolution images found for scene "+(i+1)+" ("+scene.title+"). Refusing to render weak or generic visuals.");
  const ids=[];
  for(let n=0;n<chosen.length;n++){
   const c=chosen[n],h=c.hit,id="S"+String(i+1).padStart(2,"0")+"-I"+(n+1);
   const preview=path.join(out,id+".jpg");
   await download(h.webformatURL,preview);
   const item={id,scene:i+1,creator:h.user||"Pixabay contributor",tags:h.tags||"",width:h.imageWidth,height:h.imageHeight,
    sourcePage:h.pageURL,previewFile:id+".jpg",largeImageURL:h.largeImageURL,license:"Pixabay Content License",
    licenseUrl:"https://pixabay.com/service/license-summary/",searchQuery:c.query,relevanceScore:c.score};
   assets.push(item);ids.push(id);sheetItems.push({id,scene:i+1,tags:item.tags,file:preview});
  }
  selection.push({scene:i+1,title:scene.title,selectedImageIds:ids});
  console.log("Scene "+(i+1)+": selected "+ids.join(", ")+"; matched terms and minimum 1280x720.");
 }
 await writeFile(path.join(root,"visual-selection.json"),JSON.stringify({projectId,title:script.title,source:"Automated semantic match against Pixabay tags; two high-resolution images per scene",scenes:selection},null,2)+"\n");
 await writeFile(path.join(root,"visual-assets.json"),JSON.stringify({projectId,source:"Pixabay API search; relevance-scored against scene-specific queries",assetCount:assets.length,assets},null,2)+"\n");
 const cols=4,cellW=400,cellH=225,labelH=56,gap=12,margin=12,rows=Math.ceil(sheetItems.length/cols);
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
 console.log("Prepared "+assets.length+" scene-matched images and contact sheet.");
}
main().catch(e=>{console.error(e);process.exit(1);});