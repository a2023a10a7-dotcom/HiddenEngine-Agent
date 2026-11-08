import { readFile, writeFile, mkdir } from "node:fs/promises";

const INPUT = process.env.RESEARCH_INPUT || "reports/research.json";
const OUT = process.env.OUTPUT_DIR || "reports";
const LIMIT = 5;

const POSITIVE = {
  economics: ["revenue","profit","margin","cost","business model","pricing","subscription","cash flow","valuation","market share","unit economics"],
  strategy: ["strategy","competitive","rival","acquisition","merger","bankruptcy","ipo","ceo","founder","market power","dominance","turnaround"],
  infrastructure: ["semiconductor","chip","data center","cloud","supply chain","manufacturing","factory","energy","infrastructure","capacity"],
  technology: ["artificial intelligence","ai","automation","robot","platform","software","patent","research and development","r&d"]
};
const NEGATIVE = ["product review","hands-on review","recipe","weeknight","how to","best phone","buying guide","giveaway","game review"];
const PRIMARY_HINTS = ["sec.gov","investor.","annual report","10-k","10-q","filing","official","ir."];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clean = (s="") => String(s).replace(/\s+/g," ").trim();
const countHits = (text, terms) => terms.reduce((n,t)=>n+(text.includes(t)?1:0),0);
const domain = (url="") => { try { return new URL(url).hostname.replace(/^www\./,""); } catch { return ""; } };

function assess(article) {
  const title=clean(article.title), summary=clean(article.summary);
  const text=(title+" "+summary+" "+clean(article.angle)).toLowerCase();
  const hits=Object.fromEntries(Object.entries(POSITIVE).map(([k,v])=>[k,countHits(text,v)]));
  const negative=countHits(text,NEGATIVE);
  const categories=Object.values(hits).reduce((a,b)=>a+b,0);
  const base=Number(article.score)||0;
  const fit=clamp(12 + hits.economics*7 + hits.strategy*6 + hits.infrastructure*5 + hits.technology*3 + Math.min(base,70)*0.18 - negative*13,0,100);
  const coverage=article.coverage?.reports||[];
  const domains=[...new Set(coverage.map(x=>domain(x.link||x.publisherUrl)).filter(Boolean))];
  const primary=domains.some(d=>PRIMARY_HINTS.some(h=>d.includes(h)));
  const warnings=[...(article.recommendation?.warnings||[])];
  if (domains.length<2) warnings.push("Fewer than two distinct matching coverage domains; corroboration is not established.");
  if (!primary) warnings.push("No primary-source link identified in the automated coverage leads.");
  if (negative) warnings.push("Consumer-review/how-to signals reduce fit with the channel's company-economics focus.");
  if (categories===0) warnings.push("Weak evidence of a business, strategy, infrastructure, or R&D angle.");
  return {
    title, source:article.source||"Unknown", date:article.date||null, url:article.link||"",
    channelFit:Math.round(fit), originalAutomatedScore:base,
    angle: buildAngle(article,hits), evidenceStatus: primary ? "Primary-source lead detected; verify it" : "Primary source still needed",
    coverageDomains:domains, coverageCount:domains.length, warnings:[...new Set(warnings)],
    decision: fit>=55 ? "RESEARCH" : fit>=38 ? "BACKLOG" : "REJECT",
    scoreSignals:hits
  };
}
function buildAngle(a,h) {
  const t=(a.title+" "+a.summary).toLowerCase();
  if(h.economics+h.strategy>=2) return "Investigate the hidden business model: where the money comes from, cost structure, competitive advantage, and strategic trade-offs.";
  if(h.infrastructure>=2) return "Explain the infrastructure bottleneck: who supplies it, who pays, who captures the margin, and what limits scale.";
  if(h.technology>=2) return "Connect the technical change to its commercial consequences, adoption costs, and competitive winners and losers.";
  return "Do not commission yet. Find a documented economic mechanism and a primary source before developing a story.";
}
function markdown(items, meta) {
  const lines=["# The Hidden Engine — Editorial Manager","",`Generated: ${meta.generatedAt}`,`Articles assessed: ${meta.total}`,`Recommendations: ${items.length}`,"",
    "> This is a decision-support report, not autonomous editorial approval. Scores are heuristic estimates. Matching coverage is not verification.","",
    "## Top opportunities",""];
  if(!items.length) lines.push("No story met the minimum editorial-fit threshold. Do not force a recommendation.");
  items.forEach((x,i)=>lines.push(
    `### ${i+1}. ${x.title}`,"",
    `- **Channel fit:** ${x.channelFit}/100`,
    `- **Decision:** ${x.decision}`,
    `- **Original source:** ${x.source}`,
    `- **Published:** ${x.date||"Unknown"}`,
    `- **Story lead:** ${x.url||"Missing"}`,
    `- **Editorial angle:** ${x.angle}`,
    `- **Evidence status:** ${x.evidenceStatus}`,
    `- **Coverage domains found:** ${x.coverageDomains.join(", ")||"None"}`,
    "- **Research warnings:**",...(x.warnings.length?x.warnings.map(w=>`  - ${w}`):["  - No automated warnings; manual verification is still required."]),"",
    "**Questions the researcher must answer:**",
    "1. What is the company's revenue model and who pays?",
    "2. What are the cost drivers, margins, capital needs, or financial risks?",
    "3. Which primary filings, reports, datasets, or direct statements establish the key claims?",
    "4. Who are the competitors and what strategic decision changes the outcome?",
    "5. What is fact, attributed claim, analysis, and still unknown?",""
  ));
  lines.push("## Manager's operating rules","","- Recommend no more than five stories; fewer is acceptable.",
    "- Never treat RSS summaries or matching headlines as verified facts.",
    "- Prefer company filings, annual reports, regulator records, patents, papers, and original datasets.",
    "- Separate facts, attributed claims, analysis, and speculation.",
    "- Require human approval before dossier finalization, voice generation, rendering, or publication.",
    "- Do not access private channel analytics or external accounts unless explicitly connected and authorized.","");
  return lines.join("\n");
}
async function main() {
  const raw=JSON.parse(await readFile(INPUT,"utf8"));
  const articles=Array.isArray(raw.articles)?raw.articles:[];
  const ranked=articles.map(assess).sort((a,b)=>b.channelFit-a.channelFit || (b.originalAutomatedScore-a.originalAutomatedScore));
  const selected=ranked.filter(x=>x.decision==="RESEARCH").slice(0,LIMIT);
  const meta={generatedAt:new Date().toISOString(),total:articles.length,selected:selected.length,sourceDate:raw.generatedAt||null};
  await mkdir(OUT,{recursive:true});
  await writeFile(`${OUT}/manager-report.json`,JSON.stringify({meta,selected,backlog:ranked.filter(x=>x.decision==="BACKLOG").slice(0,10)},null,2)+"\n");
  await writeFile(`${OUT}/manager-report.md`,markdown(selected,meta)+"\n");
  console.log(`Editorial manager assessed ${articles.length} stories; selected ${selected.length} for research.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
