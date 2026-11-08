import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set PROJECT_ID to a valid project folder name.");
const dir=path.join("production","projects",projectId);
const draftPath=path.join(dir,"SCRIPT-DRAFT.json");
const approvalPath=path.join(dir,"SCRIPT-APPROVAL.json");
const projectPath=path.join(dir,"project.json");

const [draftText,approvalText,projectText]=await Promise.all([
  readFile(draftPath,"utf8"),readFile(approvalPath,"utf8"),readFile(projectPath,"utf8")
]);
const draft=JSON.parse(draftText);
const approval=JSON.parse(approvalText);
const project=JSON.parse(projectText);
const digest=createHash("sha256").update(draftText).digest("hex");
const errors=[];
if(draft.projectId!==projectId||approval.projectId!==projectId) errors.push("Project ID mismatch.");
if(draft.status!=="evidence_linked_draft_needs_human_rewrite") errors.push("Script draft is blocked or has an unexpected status.");
if(approval.status!=="approved_for_recording") errors.push("SCRIPT-APPROVAL.json must set status to approved_for_recording.");
if(!approval.approvedBy?.trim()) errors.push("Approval must identify the human approver in approvedBy.");
if(!approval.approvedAt||Number.isNaN(Date.parse(approval.approvedAt))) errors.push("Approval must include a valid approvedAt timestamp.");
if(approval.draftSha256!==digest) errors.push("Approval hash does not match the current SCRIPT-DRAFT.json. Re-review and re-approve the exact draft.");
if(!Array.isArray(draft.scenes)||!draft.scenes.length) errors.push("Draft has no scenes.");

const scenes=[];
for(const [index,scene] of (draft.scenes||[]).entries()){
  const blocks=scene.narrationBlocks||[];
  if(!blocks.length){errors.push("Scene "+(scene.id||index+1)+" has no approved narration blocks.");continue;}
  for(const block of blocks){
    if(!block.narrationText?.trim()) errors.push("Claim "+(block.claimId||"unknown")+" has empty narration.");
    if(!["verified","attributed","estimated","analysis"].includes(block.classification)) errors.push("Claim "+(block.claimId||"unknown")+" has an ineligible classification.");
    if(block.editorialStatus!=="approved") errors.push("Claim "+(block.claimId||"unknown")+" is not marked editorialStatus=approved.");
    if(block.factCheck?.exactPassageConfirmed!==true) errors.push("Claim "+(block.claimId||"unknown")+" has not passed exact source-passage review.");
    if(!Array.isArray(block.sourceRefs)||!block.sourceRefs.length) errors.push("Claim "+(block.claimId||"unknown")+" has no source references.");
    if((block.sourceRefs||[]).some(ref=>!ref.passageReference?.trim())) errors.push("Claim "+(block.claimId||"unknown")+" has a source without a precise passage/page/table reference.");
  }
  scenes.push({
    title:scene.act||scene.id||"Documentary scene",
    subtitle:scene.editorialGoal||"",
    narration:blocks.map(block=>block.narrationText.trim()).join("\n\n"),
    visual_query:"",
    visual:null
  });
}
if(errors.length){
  console.error(JSON.stringify({status:"blocked",errors},null,2));
  process.exit(1);
}
const renderScript={
  schemaVersion:"1.0.0",projectId,topic:draft.topic,language:draft.language,
  targetDurationSeconds:draft.targetDurationSeconds,
  approvedBy:approval.approvedBy,approvedAt:approval.approvedAt,
  sourceDraftSha256:digest,scenes
};
const destination=path.join(dir,"script.json");
const temporary=destination+".tmp";
await writeFile(temporary,JSON.stringify(renderScript,null,2)+"\n");
await rename(temporary,destination);
project.approvals=project.approvals||{};
project.approvals.script={status:"approved_for_recording",approvedBy:approval.approvedBy,approvedAt:approval.approvedAt,draftSha256:digest};
project.updatedAt=new Date().toISOString();
await writeFile(projectPath,JSON.stringify(project,null,2)+"\n");
console.log(JSON.stringify({status:"ready_for_render",projectId,scenes:scenes.length,approvedBy:approval.approvedBy,output:destination,draftSha256:digest},null,2));
