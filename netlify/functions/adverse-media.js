// netlify/functions/adverse-media.js
// Proxy för NewsAPI + GDELT adverse media-sökning

const NEWS_API_KEY = process.env.NEWS_API_KEY;

const ADVERSE_KEYWORDS = [
  "sanction", "fraud", "corruption", "bribery", "money laundering",
  "terrorism", "crime", "indicted", "arrested", "convicted",
  "penalty", "fine", "investigation", "scandal", "convicted"
];

export default async (req) => {
  try {
    const url   = new URL(req.url);
    const query = url.searchParams.get("q");
    if (!query) return new Response(JSON.stringify({ error: "Missing query" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const adverseQuery = `"${query}" AND (${ADVERSE_KEYWORDS.slice(0, 8).join(" OR ")})`;

    // Kör NewsAPI och GDELT parallellt
    const [newsRes, gdeltRes] = await Promise.allSettled([
      // NewsAPI
      NEWS_API_KEY ? fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(adverseQuery)}&sortBy=relevancy&pageSize=10&language=en`,
        { headers: { "X-Api-Key": NEWS_API_KEY } }
      ).then(r => r.json()) : Promise.resolve(null),

      // GDELT — ingen nyckel behövs
      fetch(
        `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(adverseQuery)}&mode=artlist&maxrecords=10&format=json&timespan=12m`
      ).then(r => r.json()),
    ]);

    const articles = [];

    // NewsAPI-resultat
    if (newsRes.status === "fulfilled" && newsRes.value?.articles) {
      for (const a of newsRes.value.articles) {
        if (!a.title || a.title === "[Removed]") continue;
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

    // GDELT-resultat
    if (gdeltRes.status === "fulfilled" && gdeltRes.value?.articles) {
      for (const a of gdeltRes.value.articles) {
        if (!a.title) continue;
        articles.push({
          source:      "GDELT",
          title:       a.title,
          description: "",
          url:         a.url,
          publishedAt: a.seendate,
          outlet:      a.domain || "",
          category:    categorize(a.title),
        });
      }
    }

    // Sortera efter datum
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

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
  const t = text.toLowerCase();
  if (/sanction|ofac|eu sanction|un sanction|blacklist/.test(t)) return "Sanctions";
  if (/corrupt|brib|kickback/.test(t)) return "Corruption";
  if (/launder|money launder/.test(t)) return "Money Laundering";
  if (/terror|extremi|jihadist/.test(t)) return "Terrorism";
  if (/fraud|scam|ponzi|embezzl/.test(t)) return "Fraud";
  if (/indict|arrest|convict|prosecut|criminal/.test(t)) return "Criminal";
  if (/fine|penalty|regulat|enforcement/.test(t)) return "Regulatory";
  return "Negative News";
}
