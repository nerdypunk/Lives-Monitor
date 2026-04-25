import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUTFILE = "data/news.json";
const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const FEEDS = [
  { name: "DeSci", query: '(DeSci OR "decentralized science") sourcelang:english' },
  { name: "Longevity", query: '(longevity OR "life extension" OR "anti-aging") sourcelang:english' },
  { name: "Biotech", query: '(biotech OR "synthetic biology" OR CRISPR) sourcelang:english' },
  { name: "Crypto", query: '(crypto OR cryptocurrency OR blockchain OR Solana) sourcelang:english' },
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function gdeltUrl(query) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "10");
  url.searchParams.set("sort", "datedesc");
  return url;
}

function sourceDomain(article) {
  if (article.domain) return article.domain;
  try {
    return new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchFeed(feed) {
  const response = await fetch(gdeltUrl(feed.query), {
    headers: { accept: "application/json" },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GDELT returned ${response.status}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(cleanText(text).slice(0, 160) || "GDELT returned invalid JSON");
  }

  return (payload.articles || [])
    .filter((article) => {
      const language = cleanText(article.language).toLowerCase();
      return !language || language === "english";
    })
    .slice(0, 10)
    .map((article) => ({
      title: cleanText(article.title) || "Untitled",
      url: article.url,
      domain: sourceDomain(article),
      date: article.seendate || article.date || "",
    }));
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(OUTFILE, "utf8"));
  } catch {
    return { updatedAt: null, feeds: [] };
  }
}

async function main() {
  const existing = await readExisting();
  const feeds = [];

  for (const feed of FEEDS) {
    try {
      const articles = await fetchFeed(feed);
      feeds.push({ name: feed.name, query: feed.query, articles });
      console.log(`Fetched ${articles.length} ${feed.name} articles`);
    } catch (error) {
      console.warn(`Keeping existing ${feed.name} feed: ${error.message}`);
      const previous = existing.feeds?.find((item) => item.name === feed.name);
      feeds.push(previous || { name: feed.name, query: feed.query, error: error.message, articles: [] });
    }
  }

  const payload = {
    source: "GDELT DOC 2.0",
    updatedAt: new Date().toISOString(),
    feeds,
  };

  await mkdir("data", { recursive: true });
  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTFILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
