// netlify/functions/adverse-media.js
const NEWS_API_KEY = process.env.NEWS_API_KEY;

const ADVERSE_TERMS = ["sanction", "fraud", "corruption", "money laundering", "terrorism", "arrested", "convicted", "bribery", "criminal", "indicted"];

export default async (req) => {
  try {
    const url   = new URL(req.url);
    const query = url.searchParams.get("q");
    if (!query) return new Response(JSON.stringify({ error: "Missing query" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const articles = [];
    const seen = new Set();

    // NewsAPI — sök på namn, försök med och utan citattecken
    if (NEWS_API_KEY) {
      try {
        // Försök med citattecken för exakt matchning
        let newsUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent('"' + query + '"')}&sortBy=relevancy&pageSize=20&language=en`;
        let newsRes = await fetch(newsUrl, { headers: { "X-Api-Key": NEWS_API_KEY } });
        let newsData = await newsRes.json();
        console.log("NewsAPI (quoted) status:", newsData.status, "total:", newsData.totalResults);

        // Om inga träffar — försök utan citattecken
        if (!newsData.articles?.length || newsData.totalResults === 0) {
          newsUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=relevancy&pageSize=20&language=en`;
          newsRes = await fetch(newsUrl, { headers: { "X-Api-Key": NEWS_API_KEY } });
          newsData = await newsRes.json();
          console.log("NewsAPI (unquoted) status:", newsData.status, "total:", newsData.totalResults);
        }

        if (newsData.articles) {
          for (const a of newsData.articles) {
            if (!a.title || a.title === "[Removed]" || seen.has(a.url)) continue;
            seen.add(a.url);
            articles.push({
              source:      "NewsAPI",
              title:       a.title,
              description: a.description || "",
              url:         a.url,
              publishedAt: a.publishedAt,
              outlet:      a.source?.name || "",
              category:    categorize(a.title + " " + (a.description || "")),
            });
          }
        }
      } catch (e) { console.error("NewsAPI error:", e.message); }
    } else {
      return new Response(JSON.stringify({ error: "NEWS_API_KEY not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // Sortera — adverse-kategorier först, sedan datum
    const categoryOrder = ["Sanctions","Terrorism","Criminal","Corruption","Money Laundering","Fraud","Regulatory","Negative News","Other"];
    articles.sort((a, b) => {
      const ai = categoryOrder.indexOf(a.category);
      const bi = categoryOrder.indexOf(b.category);
      if (ai !== bi) return ai - bi;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return new Response(JSON.stringify({ query, articles, total: articles.length }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });

  } catch (err) {
    console.error("Adverse media error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

function categorize(text) {
  const t = (text || "").toLowerCase();
  if (/sanction|ofac|blacklist|designat/.test(t))         return "Sanctions";
  if (/terror|extremi|jihadist|isis|al.qaeda/.test(t))    return "Terrorism";
  if (/indict|arrest|convict|prosecut|prison|jail/.test(t)) return "Criminal";
  if (/corrupt|brib|kickback/.test(t))                    return "Corruption";
  if (/launder|money launder/.test(t))                    return "Money Laundering";
  if (/fraud|scam|ponzi|embezzl|theft|steal/.test(t))     return "Fraud";
  if (/fine|penalty|regulat|enforcement|violation/.test(t)) return "Regulatory";
  if (/kill|murder|attack|bomb|weapon|drug/.test(t))      return "Criminal";
  return "Other";
}
