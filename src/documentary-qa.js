import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const id=process.env.PROJECT_ID;
if(!id||!/^[a-z0-9-]+$/.test(id)) throw new Error("Set a valid PROJECT_ID.");
const dir=path.join("production","projects",id);
const project=JSON.parse(await readFile(path.join(dir,"project.json"),"utf8"));
const issues=[],warnings=[];
const sourceIds=new Set((project.research?.sources||[]).map(s=>s.id));
const claimIds=new Set((project.research?.claims||[]).map(c=>c.id));
if(!project.topic) issues.push("Project topic is missing.");
if(!Array.isArray(project.scenes)||project.scenes.length<5) issues.push("At least five structured scenes are required.");
if(!project.research?.sources?.length) issues.push("No source records exist.");
if(!project.research?.claims?.length) issues.push("No claim records exist.");
for(const [i,claim] of (project.research?.claims||[]).entries()){
  if(!claim.id||!claim.text) issues.push("Claim "+(i+1)+" is missing id or text.");
  if(!["verified","attributed","estimated","analysis","disputed","unverified"].includes(claim.classification)) issues.push("Claim "+(claim.id||i+1)+" has invalid classification.");
  if(!Array.isArray(claim.sourceIds)||!claim.sourceIds.length) issues.push("Claim "+(claim.id||i+1)+" has no linked sources.");
  for(const sid of claim.sourceIds||[]) if(!sourceIds.has(sid)) issues.push("Claim "+claim.id+" references missing source "+sid+".");
}
for(const [i,scene] of (project.scenes||[]).entries()){
  if(!scene.id||!scene.act) issues.push("Scene "+(i+1)+" lacks id or act.");
  if(!scene.narration?.trim()) warnings.push("Scene "+(scene.id||i+1)+" has no narration.");
  for(const cid of scene.claims||[]) if(!claimIds.has(cid)) issues.push("Scene "+scene.id+" references missing claim "+cid+".");
  for(const visual of scene.visuals||[]){
    if(!visual.type||!visual.description) issues.push("Scene "+scene.id+" has an incomplete visual record.");
    if(!visual.rightsStatus||visual.rightsStatus==="unknown") warnings.push("Visual in "+scene.id+" has unverified rights.");
    if(["archival","third_party_footage","photograph"].includes(visual.type)&&!visual.sourceUrl) issues.push("External visual in "+scene.id+" has no source URL.");
  }
}
if(!project.thesis?.centralArgument) warnings.push("Central argument has not been written.");
if(!project.approvals?.script) warnings.push("Script has no recorded human approval.");
const report={projectId:id,checkedAt:new Date().toISOString(),status:issues.length?"blocked":warnings.length?"warnings":"passed",blockingIssues:issues,warnings,counts:{scenes:project.scenes?.length||0,sources:sourceIds.size,claims:claimIds.size}};
project.quality={...report};
project.updatedAt=report.checkedAt;
await writeFile(path.join(dir,"project.json"),JSON.stringify(project,null,2)+"\n");
await writeFile(path.join(dir,"QA-REPORT.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(issues.length) process.exitCode=1;
