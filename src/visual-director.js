import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set a valid PROJECT_ID.");
const dir=path.join("production","projects",projectId);
const script=JSON.parse(await readFile(path.join(dir,"SCRIPT-DRAFT.json"),"utf8"));
const project=JSON.parse(await readFile(path.join(dir,"project.json"),"utf8"));
const assetDir=path.join(dir,"visual-assets");
await mkdir(assetDir,{recursive:true});
const assets=[],scenes=[],warnings=[];
const addAsset=(sceneId,kind,description,usage,requirements={})=>{
 const id="ASSET-"+String(assets.length+1).padStart(3,"0");
 assets.push({id,sceneId,kind,description,usage,searchBrief:requirements.searchBrief||description,preferredSources:requirements.preferredSources||[],status:"not_acquired",sourceUrl:null,creator:null,license:null,licenseEvidence:null,territory:null,expiry:null,attributionRequired:null,editorialVerification:"not_checked",notes:"Do not use in final edit until provenance, accuracy, and usage rights are recorded and approved."});
 return id;
};
for(const scene of script.scenes||[]){
 const ids=[];
 const text=scene.narrationBlocks.map(b=>b.narrationText).join(" ");
 const financial=/revenue|profit|margin|cost|sales|market share|billion|million|percent|%|debt|cash/i.test(text);
 const strategy=/strategy|decision|launch|acqui|compet|invest|partnership|leadership|turning point/i.test(text);
 ids.push(addAsset(scene.id,"archival_footage","Authentic footage of the company, product, factory, office, market, or period relevant to this chapter.","Establish time, place, and physical reality.",{searchBrief:"Authentic, date-identifiable archival footage directly related to "+project.topic,preferredSources:["Company press/media archive","Government or public institutional archive","Licensed news footage libraries"]}));
 ids.push(addAsset(scene.id,"primary_document","Original annual report, regulatory filing, investor presentation, court record, or dated company document supporting the chapter's claims.","Show the evidence on screen with page/section highlighted.",{searchBrief:"Original primary document supporting claims in "+scene.act,preferredSources:["Company investor relations","SEC/official regulator or equivalent","Court or government archive"]}));
 if(financial) ids.push(addAsset(scene.id,"data_visualization","Evidence-led chart built only from sourced figures; show period, currency, units, source, and methodology.","Make the economic mechanism legible.",{searchBrief:"Chart specification from verified project claim ledger"}));
 if(strategy) ids.push(addAsset(scene.id,"timeline_or_map","Dated strategic timeline or geographic map grounded in documented events and locations.","Clarify sequence, geography, and strategic choices.",{searchBrief:"Timeline/map derived from source-backed dates and locations"}));
 ids.push(addAsset(scene.id,"product_or_infrastructure_detail","Close-up of the relevant product, component, facility, or infrastructure.","Give the viewer a concrete visual anchor.",{searchBrief:"Accurate model- and date-matched product or infrastructure imagery",preferredSources:["Company media archive","Licensed editorial photo agency","Public institutional archive"]}));
 scenes.push({
  sceneId:scene.id,act:scene.act,targetSeconds:scene.targetSeconds,
  visualThesis:"Every shot must clarify a claim, explain a mechanism, establish context, or create a deliberate transition.",
  shotList:[
   {shot:"01",durationSeconds:Math.min(8,scene.targetSeconds),type:"evidence_open",assetIds:[ids[0],ids[1]],camera:"Slow controlled push-in; preserve document legibility.",overlay:"Chapter title only; no unsupported superlatives."},
   {shot:"02",durationSeconds:Math.min(12,scene.targetSeconds),type:"context_broll",assetIds:[ids[4]],camera:"Measured lateral move or locked archival frame.",overlay:"Date/location only when verified."},
   {shot:"03",durationSeconds:Math.min(16,scene.targetSeconds),type:financial?"data_explainer":strategy?"timeline_explainer":"document_explainer",assetIds:ids.slice(2,4),camera:"Clean motion-graphic build; one idea at a time.",overlay:"Units, period, source, and caveat visible."},
   {shot:"04",durationSeconds:Math.min(10,scene.targetSeconds),type:"editorial_transition",assetIds:[],camera:"Cut on meaningful visual or sound transition.",overlay:"No decorative stock presented as evidence."}
  ],
  claimIds:scene.narrationBlocks.map(b=>b.claimId),
  editNotes:["Use only acquired assets with cleared rights.","Match archival dates and product models to the narrated period.","Do not imply a causal relationship through juxtaposition alone.","Keep charts readable on mobile; label axes and source.","Use restrained transitions; avoid generic AI-generated pseudo-archive."],
  audioNotes:{ambience:"Subtle location-appropriate ambience only when authentic or clearly designed.",music:"Restrained underscore; duck under narration.",sfx:"Use sparingly for transitions and interface/mechanical details; never fabricate documentary events."}
 });
}
const plan={
 schemaVersion:"1.0.0",projectId,topic:project.topic,createdAt:new Date().toISOString(),
 status:"visual_plan_only_assets_not_acquired",
 format:{aspectRatio:"16:9",masterResolution:"1920x1080",frameRate:"25fps",safeMargins:"10%"},
 artDirection:{palette:["charcoal","near-black","warm ivory","muted copper"],typography:"Editorial sans-serif for labels; restrained display face for chapter titles.",texture:"Subtle film grain only where it does not obscure evidence.",cameraLanguage:"Deliberate, stable, investigative; avoid gratuitous movement.",transitions:"Hard cuts, restrained dissolves, motivated match cuts."},
 scenes,assets,
 rightsGate:{requiredFields:["sourceUrl","creator","license","licenseEvidence","territory","expiry","attributionRequired"],rule:"No asset may enter the final timeline unless provenance and usage rights are documented and approved."},
 qualityGate:["Every factual visual maps to claim IDs and source records.","Charts reproduce source figures accurately and disclose calculations.","No stock footage is misrepresented as the company, location, event, or period.","Maps use verified boundaries and dated geographic context.","All images are sharp, correctly oriented, and appropriate to the stated period.","On-screen text is proofread and readable at mobile size."],
 warnings:["This is a shot and asset acquisition plan, not a collection of acquired media.","No external assets were downloaded or licensed.","Shot durations are planning targets and must be conformed to final narration.","All rights and factual provenance require human approval."]
};
await writeFile(path.join(dir,"VISUAL-DIRECTION.json"),JSON.stringify(plan,null,2)+"\n");
const md=["# Visual direction & asset acquisition plan","", "**Status:** "+plan.status,"","## Art direction","", "- Palette: charcoal, near-black, warm ivory, muted copper","- 16:9, 1920×1080, 25fps","- Investigative camera language; restrained transitions","- Charts and documents must remain legible on mobile","",...scenes.flatMap(s=>["## "+s.sceneId+" — "+s.act,"",...s.shotList.map(sh=>"- **"+sh.shot+" · "+sh.type+" · "+sh.durationSeconds+"s:** "+sh.camera+" "+sh.overlay+" (assets: "+(sh.assetIds.join(", ")||"none")+")"),"", "**Claims:** "+(s.claimIds.join(", ")||"none"),"",...s.editNotes.map(n=>"- "+n),""]), "## Asset register","",...assets.map(a=>"- **"+a.id+" ["+a.kind+"]** — "+a.description+" Search: "+a.searchBrief+" Status: NOT ACQUIRED. Rights: NOT CLEARED."),"","## Rights and editorial gate","", "Do not use any asset in the final edit until its original URL, creator, exact license, license evidence, territory, expiry, and attribution obligations are recorded and approved. Visual suggestions are not evidence."]).join("\n");
await writeFile(path.join(dir,"VISUAL-DIRECTION.md"),md);
await writeFile(path.join(assetDir,"ASSET-REGISTER.json"),JSON.stringify({projectId,createdAt:plan.createdAt,assets},null,2)+"\n");
console.log(JSON.stringify({status:plan.status,scenes:scenes.length,assets:assets.length,outputs:["VISUAL-DIRECTION.json","VISUAL-DIRECTION.md","visual-assets/ASSET-REGISTER.json"],warnings},null,2));
