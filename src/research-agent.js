import Parser from "rss-parser";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const parser=new Parser({timeout:15000,headers:{"User-Agent":"TheHiddenEngineResearch/1.0"}});
const id=process.env.PROJECT_ID;
if(!id||!/^[a-z0-9-]+$/.test(id)) throw new Error("Set a valid PROJECT_ID.");
const dir=path.join("production","projects",id);
const projectPath=path.join(dir,"project.json");
const project=JSON.parse(await readFile(projectPath,"utf8"));
const maxPerQuery=8;
const queries=[
  project.topic,
  project.topic+" business model revenue margins",
  project.topic+" annual report financial results",
  project.topic+" strategy competition market share",
  project.topic+" regulatory filing primary source"
];
const iso=()=>new Date().toISOString();
const clean=s=>String(s??"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const existing=new Set((project.research.sources||[]).map(s=>s.url).filter(Boolean));
const discovered=[];
const failures=[];
for(const q of queries){
  const url="https://news.google.com/rss/search?q="+encodeURIComponent(q)+"&hl=en-US&gl=US&ceid=US:en";
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{"User-Agent":"Mozilla/5.0 TheHiddenEngineResearch/1.0"}});
    if(!response.ok) throw new Error("HTTP "+response.status);
    const xml=await response.text();
    const feed=await parser.parseString(xml);
    for(const item of (feed.items||[]).slice(0,maxPerQuery)){
      const link=String(item.link||"");
      if(!/^https:\/\//i.test(link)||existing.has(link)) continue;
      existing.add(link);
      const sourceName=clean(item.source?.title||item.creator||"Publisher not identified");
      const title=clean(item.title||"Untitled");
      const raw=clean(item.contentSnippet||item.content||"");
      discovered.push({
        id:"LEAD-"+(discovered.length+1).toString().padStart(3,"0"),
        publisher:sourceName,title,url:link,
        publishedAt:item.isoDate||item.pubDate||null,
        accessedAt:iso(),type:"secondary_lead",
        discoveryQuery:q,summary:raw.slice(0,900),
        verificationStatus:"unverified",
        note:"Search lead only. Open the publisher's original page and locate primary evidence before using any claim."
      });
    }
  }catch(e){failures.push({query:q,error:e.message});}
}
await mkdir(path.join(dir,"research"),{recursive:true});
const batch={projectId:id,topic:project.topic,generatedAt:iso(),queries,results:discovered,failures,limitations:[
  "Google News RSS is discovery only; it does not establish truth, independence, or source quality.",
  "Search-result links may be redirect or tracking URLs. Resolve and record the publisher's canonical article URL during human/source review.",
  "No claims have been verified or promoted automatically.",
  "Primary filings, annual reports, court/regulatory documents, original datasets, and technical papers must be added and checked directly."
]};
const batchPath=path.join(dir,"research","discovery-leads.json");
await writeFile(batchPath,JSON.stringify(batch,null,2)+"\n");
project.research.sources=[...(project.research.sources||[]),...discovered];
project.research.status=discovered.length?"leads_discovered":"discovery_incomplete";
project.research.researchLog=[...(project.research.researchLog||[]),{at:iso(),action:"news_lead_discovery",queryCount:queries.length,leadCount:discovered.length,failures:failures.length,output:batchPath}];
project.updatedAt=iso();
await writeFile(projectPath,JSON.stringify(project,null,2)+"\n");
console.log(JSON.stringify({projectId:id,leads:discovered.length,failures,output:batchPath,status:project.research.status},null,2));
