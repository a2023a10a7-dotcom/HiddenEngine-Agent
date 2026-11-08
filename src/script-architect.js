import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set PROJECT_ID to a valid project folder name.");
const dir=path.join("production","projects",projectId);
const project=JSON.parse(await readFile(path.join(dir,"project.json"),"utf8"));
const claims=project.research?.claims||[];
const sources=project.research?.sources||[];
const sourceMap=new Map(sources.map(s=>[s.id,s]));
const issues=[],warnings=[];
const usable=claims.filter(c=>["verified","attributed","estimated","analysis"].includes(c.classification));
if(!usable.length) issues.push("No eligible claims. Add researched claims before building a script plan.");
for(const c of usable){
  const linked=(c.sourceIds||[]).map(id=>sourceMap.get(id)).filter(Boolean);
  if(!linked.length) issues.push("Claim "+c.id+" has no resolvable source.");
  if(c.classification==="verified"&&!linked.some(s=>["primary_filing","annual_report","regulatory_filing","court_record","official_dataset","company_statement","technical_paper","original_interview","official_transcript"].includes(s.type))) warnings.push("Claim "+c.id+" is marked verified but has no primary-source type linked.");
  if(c.classification==="attributed"&&!c.attribution) warnings.push("Claim "+c.id+" needs an attribution label.");
  if(c.classification==="estimated"&&!c.caveat) warnings.push("Claim "+c.id+" needs an estimate caveat.");
  if(c.classification==="analysis"&&!c.reasoning) warnings.push("Claim "+c.id+" needs its reasoning chain.");
}
const unresolved=(project.research?.contradictions||[]).filter(c=>c.status!=="resolved");
if(unresolved.length) warnings.push(unresolved.length+" unresolved contradiction(s) must be addressed in the script.");
if(issues.length){
 console.error(JSON.stringify({status:"blocked",issues,warnings},null,2));
 process.exit(1);
}
const byType={
 hook:usable.filter(c=>/risk|loss|collapse|growth|revenue|profit|market|share|cost|debt|billion|million|percent|%/i.test(c.text)),
 business_model:usable.filter(c=>/revenue|subscription|advertis|margin|cost|pricing|customer|sales|profit/i.test(c.text)),
 strategy:usable.filter(c=>/strategy|decision|launch|acqui|compet|invest|partnership|patent|distribution/i.test(c.text)),
 turning_point:usable.filter(c=>/decline|increase|fall|rise|shift|change|crisis|ban|lawsuit|regulat|failure|success/i.test(c.text)),
 consequences:usable.filter(c=>/revenue|profit|loss|cost|employee|market|customer|debt|cash|share/i.test(c.text))
};
const buckets=[
 {id:"S01",act:"Cold open",goal:"Establish the stakes with the strongest specific, source-backed fact.",candidates:byType.hook},
 {id:"S02",act:"The system",goal:"Explain the company, market, customer, and product context.",candidates:usable},
 {id:"S03",act:"The hidden engine",goal:"Explain how money is made, where costs sit, and where value accrues.",candidates:byType.business_model},
 {id:"S04",act:"The strategic bet",goal:"Reconstruct documented decisions, incentives, and trade-offs.",candidates:byType.strategy},
 {id:"S05",act:"The turning point",goal:"Show what changed, when, and what evidence supports the shift.",candidates:byType.turning_point},
 {id:"S06",act:"Who wins and pays",goal:"Quantify consequences and distinguish company disclosures from independent estimates.",candidates:byType.consequences},
 {id:"S07",act:"What remains",goal:"Resolve the thesis, state the counterargument, and disclose what remains unknown.",candidates:usable}
];
const scenes=buckets.map((b,i)=>({
 id:b.id,act:b.act,targetSeconds:project.scenes?.[i]?.targetSeconds||60,editorialGoal:b.goal,
 candidateClaimIds:[...new Set(b.candidates.map(c=>c.id))].slice(0,12),
 requiredChecks:["Select only claims that directly support this scene.","Record the precise source passage, page/table/section, and publication date.","Do not upgrade estimates, attributions, or analysis into verified fact.","Add counter-evidence and uncertainty where material."],
 narrationDraft:null,visualIdeas:[],status:"outline_only"
}));
const packet={
 schemaVersion:"1.0.0",projectId,topic:project.topic,createdAt:new Date().toISOString(),
 status:"outline_only_not_script_ready",
 thesisPrompt:"What is the hidden economic mechanism, and which documented strategic choices made it matter?",
 workingThesis:project.thesis?.centralArgument||null,
 counterArgument:project.thesis?.counterArgument||null,
 sourceCoverage:{sourceCount:sources.length,claimCount:claims.length,eligibleClaimCount:usable.length,unresolvedContradictions:unresolved.length},
 scenes,
 mandatoryEditorialRules:[
  "No narration sentence may introduce a factual assertion without one or more claim IDs.",
  "Keep reported fact, attributed statement, estimate, analysis, and disputed claim linguistically distinct.",
  "Do not infer causation from correlation or chronology alone.",
  "Do not invent quotations, numbers, dates, scenes, or visual evidence.",
  "Use primary documents for financial figures whenever available; record fiscal period and currency.",
  "Visual concepts are not acquired assets. Rights and provenance must be cleared separately."
 ],
 blockingIssues:issues,warnings
};
await writeFile(path.join(dir,"SCRIPT-ARCHITECTURE.json"),JSON.stringify(packet,null,2)+"\n");
console.log(JSON.stringify({status:packet.status,path:path.join(dir,"SCRIPT-ARCHITECTURE.json"),sourceCoverage:packet.sourceCoverage,warnings},null,2));
