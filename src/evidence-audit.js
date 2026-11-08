import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set PROJECT_ID to a valid project folder name.");
const dir=path.join("production","projects",projectId);
const projectPath=path.join(dir,"project.json");
const project=JSON.parse(await readFile(projectPath,"utf8"));
const sources=project.research?.sources||[];
const claims=project.research?.claims||[];
const sourceById=new Map(sources.map(s=>[s.id,s]));
const issues=[],warnings=[],claimRows=[];
const primaryTypes=new Set(["primary_filing","annual_report","regulatory_filing","court_record","official_dataset","company_statement","technical_paper","original_interview","official_transcript"]);
const classifications=new Set(["verified","attributed","estimated","analysis","disputed","unverified"]);
const isUrl=u=>{try{const x=new URL(u);return x.protocol==="https:"||x.protocol==="http:";}catch{return false;}};
const seenUrls=new Map();
for(const [i,s] of sources.entries()){
  if(!s.id) issues.push("Source row "+(i+1)+" has no stable id.");
  if(!s.title||!s.publisher) issues.push("Source "+(s.id||i+1)+" needs title and publisher.");
  if(!isUrl(s.url)) issues.push("Source "+(s.id||i+1)+" has an invalid or missing URL.");
  if(!s.type) issues.push("Source "+(s.id||i+1)+" has no source type.");
  if(s.url){if(seenUrls.has(s.url)) warnings.push("Duplicate source URL shared by "+seenUrls.get(s.url)+" and "+s.id+".");else seenUrls.set(s.url,s.id);}
  if(s.type==="secondary_lead"||s.verificationStatus==="unverified") warnings.push("Source "+(s.id||i+1)+" is a discovery lead, not verified evidence.");
}
for(const [i,c] of claims.entries()){
  const row={claimId:c.id||"CLAIM-"+(i+1),text:c.text||"",classification:c.classification||"missing",sourceCount:0,primarySourceCount:0,issues:[],warnings:[]};
  if(!c.id||!c.text) row.issues.push("Claim needs stable id and text.");
  if(!classifications.has(c.classification)) row.issues.push("Claim classification is missing or invalid.");
  if(!Array.isArray(c.sourceIds)||!c.sourceIds.length) row.issues.push("No supporting source IDs.");
  for(const sid of c.sourceIds||[]){
    const s=sourceById.get(sid);
    if(!s){row.issues.push("Missing source reference: "+sid);continue;}
    row.sourceCount++;
    if(primaryTypes.has(s.type)) row.primarySourceCount++;
    if(s.verificationStatus==="unverified"||s.type==="secondary_lead") row.warnings.push("Linked source "+sid+" remains an unverified discovery lead.");
  }
  if(c.classification==="verified"&&row.primarySourceCount===0) row.warnings.push("Marked verified without a linked source classified as primary; review before narration.");
  if(c.classification==="estimated"&&!c.caveat) row.warnings.push("Estimate has no caveat or methodology note.");
  if(c.classification==="attributed"&&!c.attribution) row.warnings.push("Attributed claim has no named speaker/organization.");
  if(c.classification==="analysis"&&!c.reasoning) row.warnings.push("Analysis claim has no written reasoning chain.");
  issues.push(...row.issues.map(x=>row.claimId+": "+x));
  warnings.push(...row.warnings.map(x=>row.claimId+": "+x));
  claimRows.push(row);
}
const contradictionRows=(project.research?.contradictions||[]).map((x,i)=>({
  id:x.id||"CON-"+(i+1),description:x.description||x.topic||"Unspecified contradiction",
  status:x.status||"unresolved",claimIds:x.claimIds||[]
}));
for(const x of contradictionRows) if(x.status!=="resolved") warnings.push("Contradiction "+x.id+" remains "+x.status+".");
const report={
  projectId,checkedAt:new Date().toISOString(),
  status:issues.length?"blocked":warnings.length?"review_required":"structurally_consistent",
  summary:{sources:sources.length,primarySources:sources.filter(s=>primaryTypes.has(s.type)).length,claims:claims.length,claimsWithPrimaryLinks:claimRows.filter(c=>c.primarySourceCount>0).length,unresolvedContradictions:contradictionRows.filter(c=>c.status!=="resolved").length},
  issues,warnings,claimLedger:claimRows,contradictions:contradictionRows,
  disclaimer:"This is metadata and traceability QA, not independent verification of source authenticity, claim truth, completeness, or legal rights."
};
await writeFile(path.join(dir,"EVIDENCE-AUDIT.json"),JSON.stringify(report,null,2)+"\n");
project.research.evidenceAudit={status:report.status,checkedAt:report.checkedAt,report:"EVIDENCE-AUDIT.json"};
project.updatedAt=report.checkedAt;
await writeFile(projectPath,JSON.stringify(project,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(issues.length) process.exitCode=1;
