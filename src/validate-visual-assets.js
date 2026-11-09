import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set a valid PROJECT_ID.");
const root=path.resolve("production","projects",projectId);
const manifestPath=path.join(root,"visual-assets","approved-assets.json");
const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
if(manifest.projectId!==projectId) throw new Error("Visual asset manifest projectId mismatch.");
if(manifest.status!=="approved") throw new Error("Asset manifest status must be approved.");
if(!Array.isArray(manifest.assets)||!manifest.assets.length) throw new Error("No visual assets listed.");
const errors=[],ready=[];
const run=(cmd,args)=>new Promise((resolve,reject)=>{
 const p=spawn(cmd,args,{stdio:["ignore","pipe","pipe"]});let out="",err="";
 p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
 p.on("error",reject);p.on("close",code=>code===0?resolve(out):reject(new Error(err||cmd+" exited "+code)));
});
const seen=new Set();
for(const asset of manifest.assets){
 const label=asset.id||"unnamed asset";
 if(!asset.id||seen.has(asset.id)){errors.push(label+": missing or duplicate id.");continue;} seen.add(asset.id);
 if(!/^S\d{2}$/.test(asset.sceneId||"")){errors.push(label+": sceneId must match S01, S02, etc.");continue;}
 if(!["image","video"].includes(asset.mediaType)){errors.push(label+": mediaType must be image or video.");continue;}
 if(!/^https:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|www\.pexels\.com|images\.pexels\.com|openverse\.org)\//i.test(asset.sourceUrl||"")){errors.push(label+": source must be Wikimedia Commons, Pexels, or Openverse.");continue;}
 if(asset.rightsStatus!=="cleared"||asset.editorialVerification!=="approved"){errors.push(label+": rights and editorial approval are both required.");continue;}
 for(const field of ["sourceUrl","creator","license","licenseEvidence","territory","attribution"]){
  if(!String(asset[field]||"").trim()){errors.push(label+": missing "+field+".");}
 }
 if(asset.expiry && Date.parse(asset.expiry)<Date.now()){errors.push(label+": license expiry has passed.");}
 if(errors.some(e=>e.startsWith(label+":"))) continue;
 const relative=String(asset.filePath||"");
 if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).includes("..")){errors.push(label+": filePath must be a safe project-relative path.");continue;}
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)){errors.push(label+": filePath escapes project directory.");continue;}
 try{
  const info=await stat(file);
  if(!info.isFile()||info.size===0) throw new Error("file is empty or not a regular file");
  const probe=JSON.parse(await run("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=codec_type,width,height","-of","json",file]));
  const streams=probe.streams||[];
  const valid=asset.mediaType==="image"
   ? streams.some(s=>s.codec_type==="video"&&s.width>=640&&s.height>=360)
   : streams.some(s=>s.codec_type==="video"&&s.width>=640&&s.height>=360);
  if(!valid) throw new Error("media has no usable video/image stream or resolution is below 640x360");
  ready.push({id:asset.id,sceneId:asset.sceneId,mediaType:asset.mediaType,filePath:relative,sourceUrl:asset.sourceUrl,creator:asset.creator,license:asset.license,licenseEvidence:asset.licenseEvidence,territory:asset.territory,expiry:asset.expiry||null,attribution:asset.attribution,sha256:asset.sha256||null});
 }catch(e){errors.push(label+": "+e.message);}
}
const sceneIds=new Set(ready.map(a=>a.sceneId));
const report={projectId,checkedAt:new Date().toISOString(),status:errors.length?"blocked":"ready",assetCount:ready.length,assets:ready,errors,rule:"Only explicitly rights-cleared and editorially approved local assets are eligible for rendering. Illustrative assets must not be represented as evidence."};
await writeFile(path.join(root,"VISUAL-ASSETS-READY.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,assetCount:ready.length,scenesWithAssets:[...sceneIds],errors},null,2));
if(errors.length) process.exit(1);
