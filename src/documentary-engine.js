import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "production/projects";
const now = () => new Date().toISOString();
const slug = (s) => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70) || "untitled";
const clean = (s) => String(s ?? "").trim();

function parseArgs(argv) {
  const args = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === "--topic") args.topic = argv[++i];
    else if (argv[i] === "--language") args.language = argv[++i];
    else if (argv[i] === "--duration") args.duration = Number(argv[++i]);
    else if (argv[i] === "--help") args.help = true;
  }
  return args;
}

function buildProject({topic, language, duration}) {
  const createdAt = now();
  const projectId = createdAt.slice(0,10) + "-" + slug(topic);
  const sections = [
    ["Cold open",0.07,"Open with a verified contradiction, consequence, or striking documented fact."],
    ["The system",0.15,"Explain the company, product, market, and business model."],
    ["The hidden engine",0.22,"Reveal revenue mechanics, costs, margins, infrastructure, distribution, and incentives."],
    ["The strategic bet",0.20,"Reconstruct documented decisions, constraints, competitors, and trade-offs."],
    ["The turning point",0.18,"Show what changed, supported by dated primary evidence."],
    ["Who wins and pays",0.12,"Trace measurable economic effects; label estimates and uncertainty."],
    ["What remains",0.06,"Close with a balanced conclusion and unresolved questions."]
  ];
  const scenes = sections.map(([act,share,purpose],i)=>({
    id:"S"+String(i+1).padStart(2,"0"), act, purpose,
    targetSeconds:Math.max(15,Math.round(duration*share)),
    narration:"",
    claims:[],
    visuals:[],
    sound:{musicCue:"",soundEffects:[]},
    status:"blocked_pending_research"
  }));
  return {
    schemaVersion:"1.0.0",
    projectId, createdAt, updatedAt:createdAt,
    channel:"The Hidden Engine",
    topic, language, targetDurationSeconds:duration,
    editorialPromise:"Reveal the documented economic and strategic mechanism behind the story.",
    status:"topic_received",
    thesis:{workingQuestion:"", centralArgument:"", counterArgument:"", conclusion:""},
    story:{hook:"", audienceStakes:"", narrativeArc:sections.map(x=>x[0])},
    research:{status:"not_started", questions:[
      "What is the strongest primary evidence for the central event or claim?",
      "How does the business model create revenue and incur costs?",
      "Which financial metrics are disclosed, and for what period?",
      "What strategic decisions are documented, and what alternatives existed?",
      "Which competitors or substitutes provide a meaningful comparison?",
      "What independent evidence challenges the leading interpretation?",
      "What is still unknown, disputed, estimated, or not publicly disclosed?"
    ], claims:[], sources:[], contradictions:[], researchLog:[]},
    scenes,
    assetRegister:[],
    production:{voice:{provider:"ElevenLabs",voiceIdConfigured:Boolean(process.env.ELEVENLABS_VOICE_ID),status:"not_started"}, edit:{status:"not_started"}, music:{status:"not_started"}, captions:{status:"not_started"}},
    quality:{status:"not_run",blockingIssues:[],warnings:[]},
    approvals:{script:null,finalVideo:null,publication:null},
    delivery:{video:null,sourceLog:null,qaReport:null}
  };
}

async function main() {
  const args=parseArgs(process.argv.slice(2));
  if(args.help) {
    console.log('Usage: node src/documentary-engine.js --topic "Company or story" [--language en] [--duration 480]');
    return;
  }
  const topic=clean(args.topic);
  if(!topic) throw new Error('A single topic is required. Use --topic "..."');
  const duration=Number.isFinite(args.duration)&&args.duration>=180&&args.duration<=1800?Math.round(args.duration):480;
  const project=buildProject({topic,language:clean(args.language)||"en",duration});
  const dir=path.join(ROOT,project.projectId);
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,"project.json"),JSON.stringify(project,null,2)+"\n",{flag:"wx"}).catch(async e=>{
    if(e.code!=="EEXIST") throw e;
    throw new Error("Project already exists: "+project.projectId);
  });
  const brief=[
    "# Documentary production brief","",
    "**Topic:** "+topic,
    "**Project:** "+project.projectId,
    "**Status:** TOPIC RECEIVED — RESEARCH REQUIRED",
    "",
    "## Editorial direction",
    "Find the hidden business mechanism: who pays, what they pay for, what it costs to deliver, where margins accrue, and which strategic choices explain the outcome.",
    "",
    "## Non-negotiable evidence rules",
    "- No factual narration until each material claim has a source record.",
    "- Prefer filings, annual reports, court/regulatory records, original datasets, technical papers, and first-party documentation.",
    "- Distinguish reported fact, attributed statement, estimate, analysis, and speculation.",
    "- A search result or repeated headline is a lead, not corroboration.",
    "- Never use illustrative footage as if it depicts the actual company, person, product, or event.",
    "- Record asset provenance, license, permitted use, and attribution before edit approval.",
    "",
    "## Production gates",
    "1. Research dossier contains source-backed claims and documented contradictions.",
    "2. Story thesis and counterargument are approved.",
    "3. Every narration paragraph maps to claim IDs.",
    "4. Every visual has a provenance/type record and rights status.",
    "5. Voice, edit, captions, mix, and technical QA pass.",
    "6. Human owner approves final video; publishing remains a separate action.",
    "",
    "## Scene architecture",
    ...project.scenes.map(s=>"- **"+s.id+" — "+s.act+"** ("+s.targetSeconds+"s): "+s.purpose),
    "",
    "## Next required action",
    "Research the topic and populate research.claims, research.sources, and research.contradictions. Do not generate narration from the topic alone."
  ].join("\n");
  await writeFile(path.join(dir,"PRODUCTION-BRIEF.md"),brief+"\n");
  console.log("Created documentary project: "+dir);
}
main().catch(e=>{console.error("Documentary engine:",e.message);process.exit(1);});
