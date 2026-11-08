import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set PROJECT_ID to a valid project folder name.");
const dir=path.join("production","projects",projectId);
const project=JSON.parse(await readFile(path.join(dir,"project.json"),"utf8"));
const architecture=JSON.parse(await readFile(path.join(dir,"SCRIPT-ARCHITECTURE.json"),"utf8"));
const claims=project.research?.claims||[];
const sources=project.research?.sources||[];
const claimMap=new Map(claims.map(c=>[c.id,c]));
const sourceMap=new Map(sources.map(s=>[s.id,s]));
const allowed=new Set(["verified","attributed","estimated","analysis"]);
const issues=[],warnings=[];
if(architecture.projectId!==projectId) issues.push("Story architecture belongs to a different project.");
if(architecture.status!=="outline_only_not_script_ready") warnings.push("Story architecture status is not the expected outline-only state.");
const scenes=[];
for(const outline of architecture.scenes||[]){
  const selected=(outline.candidateClaimIds||[]).map(id=>claimMap.get(id)).filter(Boolean).filter(c=>allowed.has(c.classification));
  const blocks=[];
  for(const c of selected){
    const linked=(c.sourceIds||[]).map(id=>sourceMap.get(id)).filter(Boolean);
    if(!c.text?.trim()){warnings.push("Claim "+c.id+" has empty text and was omitted.");continue;}
    if(!linked.length){warnings.push("Claim "+c.id+" has no resolvable source and was omitted.");continue;}
    const sourceRefs=linked.map(s=>({
      sourceId:s.id,title:s.title||"",publisher:s.publisher||"",
      url:s.canonicalUrl||s.url||"",publishedAt:s.publishedAt||null,
      snapshotPath:s.snapshotPath||null,sourceType:s.type||"unknown",
      verificationStatus:s.verificationStatus||"not_recorded",
      passageReference:c.passageReference||c.pageReference||null
    }));
    const qualification={
      verified:"The research ledger classifies this as verified; independently recheck the cited passage before recording.",
      attributed:"Attribute this statement explicitly to "+(c.attribution||"the named source");,
      estimated:"Present this only as an estimate and state its limitations: "+(c.caveat||"caveat not supplied")+".",
      analysis:"Present this as analysis, not reported fact. Reasoning: "+(c.reasoning||"reasoning not supplied")+"."
    }[c.classification];
    blocks.push({
      claimId:c.id,classification:c.classification,
      narrationText:c.text.trim(),qualification,
      sourceRefs,confidence:c.confidence||"not_assessed",
      editorialStatus:"needs_passage_review",
      factCheck:{exactPassageConfirmed:false,independentCorroboration:false}
    });
  }
  const transition=({
    "Cold open":"Begin with the documented stakes. Do not imply more than the cited evidence establishes.",
    "The system":"Now establish the company, market, product, and time period before explaining the mechanism.",
    "The hidden engine":"Follow the money: connect revenue, customer value, costs, and margins only where the ledger supports them.",
    "The strategic bet":"Move from economics to choices. Separate documented decisions from interpretations of motive.",
    "The turning point":"Show the change over time. Avoid claiming causation unless the sources demonstrate it.",
    "Who wins and pays":"Translate the evidence into consequences for customers, workers, competitors, and investors where measurable.",
    "What remains":"Return to the central question, state the strongest counterargument, and leave unresolved facts visible."
  })[outline.act]||"Advance the argument using only supported claims.";
  scenes.push({
    id:outline.id,act:outline.act,targetSeconds:outline.targetSeconds,
    editorialGoal:outline.editorialGoal,openingDirection:transition,
    narrationBlocks:blocks,
    missingEvidence:(outline.candidateClaimIds||[]).filter(id=>!claimMap.has(id)),
    visualDirection:[],
    soundDirection:{music:"Use restrained documentary underscore; do not use music to imply certainty or emotion unsupported by the story.",sfx:[]},
    status:blocks.length?"draft_assembly_needs_editorial_rewrite":"blocked_no_eligible_evidence"
  });
}
const total= scenes.reduce((n,s)=>n+s.narrationBlocks.length,0);
if(!total) issues.push("No source-linked narration blocks could be assembled.");
const script={
 schemaVersion:"1.0.0",projectId,topic:project.topic,generatedAt:new Date().toISOString(),
 status:issues.length?"blocked": "evidence_linked_draft_needs_human_rewrite",
 language:project.language||"en",targetDurationSeconds:project.targetDurationSeconds||480,
 editorialThesis:project.thesis?.centralArgument||architecture.workingThesis||null,
 counterArgument:project.thesis?.counterArgument||architecture.counterArgument||null,
 editorialDisclaimer:"This is a constrained draft assembly, not a polished final narration. Every block must be rewritten for clarity and checked against the original cited passage. Claim classifications are editorial metadata, not proof.",
 scenes,
 evidenceCoverage:{sceneCount:scenes.length,narrationBlocks:total,claimsUsed:[...new Set(scenes.flatMap(s=>s.narrationBlocks.map(b=>b.claimId)))].length,blocksNeedingPassageReview:total},
 issues,warnings,
 productionGate:{voiceGenerationAllowed:false,reason:"Human script approval and passage-level fact check have not been recorded."}
};
await writeFile(path.join(dir,"SCRIPT-DRAFT.json"),JSON.stringify(script,null,2)+"\n");
const md=[
"# Evidence-linked documentary script draft","",
"**Topic:** "+project.topic,
"**Status:** "+script.status,
"",
"> This is a constrained draft assembly. It is not ready for voice recording. Verify every source passage and rewrite for natural narration.",
...scenes.flatMap(s=>[
"## "+s.id+" — "+s.act,
"",
"*"+s.editorialGoal+"*",
"",
s.openingDirection,
"",
...(s.narrationBlocks.length?s.narrationBlocks.flatMap(b=>[
"### ["+b.claimId+" · "+b.classification+"]",
b.narrationText,
"",
"**Editorial qualification:** "+b.qualification,
"**Sources:** "+b.sourceRefs.map(r=>r.sourceId+" — "+r.publisher+": "+r.title+" ("+r.url+")"+(r.passageReference?" · "+r.passageReference:" · precise passage/page reference missing")).join("; "),
"**Check:** exact passage confirmed = no; independent corroboration = no.",
""
]):["[BLOCKED: no eligible source-linked claims for this scene.]",""])
]),
"## Production gate",
"Do not generate voice until each factual statement has been checked against the original source, passage/page references are recorded, counter-evidence is addressed, and a human editor approves the script.",
""
]).join("\n");
await writeFile(path.join(dir,"SCRIPT-DRAFT.md"),md);
console.log(JSON.stringify({projectId,status:script.status,scenes:scenes.length,narrationBlocks:total,issues,warnings,outputs:["SCRIPT-DRAFT.json","SCRIPT-DRAFT.md"]},null,2));
if(issues.length) process.exitCode=1;
