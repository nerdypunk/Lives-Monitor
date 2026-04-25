import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUTFILE = "data/news.json";
const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const FEEDS = [
  {
    name: "DeSci",
    queries: [
      '(DeSci OR "decentralized science") sourcelang:english',
      '("open science" OR "science funding" OR "citizen science" OR "research funding") sourcelang:english',
      '(science OR research OR "scientific research") sourcelang:english',
    ],
  },
  {
    name: "Longevity",
    queries: [
      '(longevity OR "life extension" OR "anti-aging") sourcelang:english',
      '(longevity OR "life extension" OR "anti aging" OR "healthy aging" OR "aging research") sourcelang:english',
      '("aging" OR "age-related" OR "lifespan" OR "healthspan") sourcelang:english',
    ],
  },
  {
    name: "Biotech",
    queries: [
      '(biotech OR "synthetic biology" OR CRISPR) sourcelang:english',
      '(biotechnology OR biotech OR CRISPR OR "gene editing" OR "cell therapy") sourcelang:english',
      '("drug discovery" OR genomics OR biomanufacturing OR "clinical trial") sourcelang:english',
    ],
  },
  {
    name: "Crypto",
    queries: [
      '(crypto OR cryptocurrency OR blockchain OR Solana) sourcelang:english',
      '(cryptocurrency OR blockchain OR bitcoin OR ethereum OR Solana OR stablecoin) sourcelang:english',
      '("digital assets" OR token OR web3 OR DeFi) sourcelang:english',
    ],
  },
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

async function fetchFeedQuery(query) {
  const response = await fetch(gdeltUrl(query), {
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

async function fetchFeed(feed) {
  const seen = new Set();
  const combined = [];

  for (const query of feed.queries) {
    const articles = await fetchFeedQuery(query);
    for (const article of articles) {
      if (!article.url || seen.has(article.url)) continue;
      seen.add(article.url);
      combined.push(article);
      if (combined.length >= 10) return combined;
    }
    console.warn(`${feed.name} has ${combined.length} articles after query: ${query}`);
  }

  return combined;
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
      feeds.push({ name: feed.name, queries: feed.queries, articles });
      console.log(`Fetched ${articles.length} ${feed.name} articles`);
    } catch (error) {
      console.warn(`Keeping existing ${feed.name} feed: ${error.message}`);
      const previous = existing.feeds?.find((item) => item.name === feed.name);
      feeds.push(previous || { name: feed.name, queries: feed.queries, error: error.message, articles: [] });
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
