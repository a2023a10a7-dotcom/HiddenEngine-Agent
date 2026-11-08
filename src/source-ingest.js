import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const projectId=process.env.PROJECT_ID;
if(!projectId||!/^[a-z0-9-]+$/.test(projectId)) throw new Error("Set PROJECT_ID to a valid project folder name.");
const dir=path.join("production","projects",projectId);
const projectPath=path.join(dir,"project.json");
const project=JSON.parse(await readFile(projectPath,"utf8"));
const outDir=path.join(dir,"research","source-snapshots");
await mkdir(outDir,{recursive:true});
const MAX_BYTES=1500000, TIMEOUT=15000;
const strip=s=>String(s||"").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ").replace(/<!--[\s\S]*?-->/g," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim();
const meta=(html,wanted)=>{for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const t=tag[0];const key=(t.match(/(?:name|property)=["']([^"']+)["']/i)||[])[1];const value=(t.match(/content=["']([^"']*)["']/i)||[])[1];if(key?.toLowerCase()===wanted.toLowerCase())return strip(value||"");}return "";};
const titleOf=html=>strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"");
const safeUrl=value=>{try{const u=new URL(value);if(!["http:","https:"].includes(u.protocol)||u.username||u.password)return null;const host=u.hostname.toLowerCase();if(host==="localhost"||host.endsWith(".localhost")||host==="127.0.0.1"||host==="0.0.0.0"||host==="::1"||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host))return null;return u;}catch{return null;}};
const candidates=(project.research?.sources||[]).filter(s=>s.url&&!s.snapshotPath);
const results=[],errors=[];
for(const source of candidates){
  const u=safeUrl(source.url);
  if(!u){errors.push({sourceId:source.id,error:"Rejected unsafe or invalid URL."});continue;}
  try{
    const response=await fetch(u,{redirect:"follow",signal:AbortSignal.timeout(TIMEOUT),headers:{"User-Agent":"TheHiddenEngineResearchBot/1.0","Accept":"text/html,application/xhtml+xml,application/pdf;q=0.8"}});
    const type=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
    const length=Number(response.headers.get("content-length")||0);
    const record={sourceId:source.id,requestedUrl:source.url,canonicalUrl:response.url,status:response.status,contentType:type,fetchedAt:new Date().toISOString(),extractionStatus:"metadata_only",title:source.title||"",publisher:source.publisher||"",publishedAt:source.publishedAt||null};
    if(!response.ok) throw new Error("HTTP "+response.status);
    if(length>MAX_BYTES) throw new Error("Response exceeds safety limit.");
    if(type==="application/pdf"){
      record.extractionStatus="pdf_requires_dedicated_extractor";
      record.note="PDF detected. No PDF text was extracted in this stage.";
    }else if(type==="text/html"||type==="application/xhtml+xml"){
      const html=await response.text();
      if(Buffer.byteLength(html,"utf8")>MAX_BYTES) throw new Error("HTML body exceeds safety limit.");
      const title=titleOf(html)||meta(html,"og:title")||source.title||"";
      const description=meta(html,"description")||meta(html,"og:description");
      const author=meta(html,"author")||meta(html,"article:author");
      const published=meta(html,"article:published_time")||meta(html,"date");
      const main=html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1]||html;
      const text=strip(main).slice(0,18000);
      record.title=title;record.description=description;record.author=author;record.publisherPublishedAt=published;
      record.extractedText=text;record.textCharacters=text.length;
      record.contentSha256=createHash("sha256").update(text).digest("hex");
      record.extractionStatus=text.length>=300?"html_text_extracted":"thin_or_blocked_content";
      record.note="Automated extraction is a reading aid only. Check context, tables, footnotes, and original documents manually.";
    }else{
      record.extractionStatus="unsupported_content_type";
      record.note="Only HTML text is extracted; binary files are not downloaded.";
    }
    const file=String(source.id||"source").replace(/[^a-zA-Z0-9_-]/g,"_")+".json";
    await writeFile(path.join(outDir,file),JSON.stringify(record,null,2)+"\n");
    source.canonicalUrl=record.canonicalUrl;source.snapshotPath=path.join("research","source-snapshots",file);
    source.ingestionStatus=record.extractionStatus;source.fetchedAt=record.fetchedAt;
    results.push({sourceId:source.id,status:record.extractionStatus,canonicalUrl:record.canonicalUrl});
  }catch(e){errors.push({sourceId:source.id,error:e.message});}
}
project.research.sourceIngestion={at:new Date().toISOString(),attempted:candidates.length,succeeded:results.length,failed:errors.length};
project.research.researchLog=[...(project.research.researchLog||[]),{at:project.research.sourceIngestion.at,action:"public_source_ingestion",attempted:candidates.length,succeeded:results.length,failed:errors.length}];
project.updatedAt=project.research.sourceIngestion.at;
await writeFile(projectPath,JSON.stringify(project,null,2)+"\n");
const summary={projectId,attempted:candidates.length,results,errors,limitations:["No login, paywall bypass, or script execution.","PDFs are detected but not parsed.","Extracted text may omit tables, footnotes, charts, or dynamic content.","Extraction is not fact-checking; rights and quotation limits need separate review."]};
await writeFile(path.join(dir,"research","ingestion-report.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
