import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUTFILE = "data/news.json";
const REQUEST_TIMEOUT_MS = 35000;
const REQUEST_RETRIES = 2;
const REQUEST_PAUSE_MS = 800;
const CATEGORY_LIMIT = 10;

const FEEDS = [
  {
    name: "DeSci",
    include: /\b(?:desci|decentralized science|bio protocol)\b/i,
    exclude: /\b(?:chart|forecast|live price|price prediction|price today)\b/i,
    sources: [
      {
        name: "Google News DeSci",
        url: "https://news.google.com/rss/search?q=DeSci%20OR%20%22decentralized%20science%22%20OR%20%22BIO%20Protocol%22&hl=en-US&gl=US&ceid=US:en",
      },
    ],
  },
  {
    name: "Longevity",
    sources: [
      { name: "Lifespan.io", url: "https://lifespan.io/feed/" },
      { name: "Longevity.Technology", url: "https://longevity.technology/feed/" },
    ],
  },
  {
    name: "Biotech",
    sources: [
      { name: "Nature Biotechnology", url: "https://www.nature.com/nbt.rss" },
      { name: "arXiv q-bio", url: "https://export.arxiv.org/rss/q-bio" },
      { name: "Phys.org Biotechnology", url: "https://phys.org/rss-feed/biology-news/biotechnology/" },
    ],
  },
  {
    name: "Crypto",
    sources: [
      { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
      { name: "The Block", url: "https://www.theblock.co/rss.xml" },
    ],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€�/g, '"')
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/Â/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCdata(value) {
  return String(value ?? "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(value) {
  return stripCdata(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function stripTags(value) {
  return cleanText(decodeEntities(value).replace(/<[^>]+>/g, " "));
}

function tagText(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? cleanText(decodeEntities(match[1])) : "";
}

function tagHtml(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? match[1] : "";
}

function attrText(xml, tagName, attrName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttr = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagMatch = xml.match(new RegExp(`<${escapedTag}\\b[^>]*>`, "i"));
  if (!tagMatch) return "";
  const attrMatch = tagMatch[0].match(new RegExp(`${escapedAttr}=["']([^"']+)["']`, "i"));
  return attrMatch ? cleanText(decodeEntities(attrMatch[1])) : "";
}

function atomLink(entry) {
  const links = [...entry.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const alternate = links.find((link) => /rel=["']alternate["']/i.test(link)) || links[0] || "";
  const match = alternate.match(/href=["']([^"']+)["']/i);
  return match ? cleanText(decodeEntities(match[1])) : "";
}

function sourceDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function articleFromBlock(block, source) {
  const rawLink = tagText(block, "feedburner:origLink")
    || tagText(block, "link")
    || tagText(block, "guid")
    || atomLink(block);
  const url = cleanText(rawLink);
  const itemSourceUrl = attrText(block, "source", "url");
  const itemSourceName = tagText(block, "source");
  const title = stripTags(tagHtml(block, "title")) || "Untitled";
  const summary = stripTags(
    tagHtml(block, "description")
      || tagHtml(block, "summary")
      || tagHtml(block, "content")
      || tagHtml(block, "content:encoded")
  );
  const date = normalizeDate(
    tagText(block, "pubDate")
      || tagText(block, "dc:date")
      || tagText(block, "published")
      || tagText(block, "updated")
      || attrText(block, "updated", "date")
  );

  return {
    title,
    url,
    domain: sourceDomain(itemSourceUrl || url),
    date,
    source: itemSourceName || source.name,
    summary,
  };
}

function parseFeed(xml, source) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entryBlocks = itemBlocks.length
    ? []
    : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);

  return [...itemBlocks, ...entryBlocks]
    .map((block) => articleFromBlock(block, source))
    .filter((article) => article.url && article.title);
}

async function fetchWithRetry(url) {
  let lastError;

  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "user-agent": "LivesMonitor/1.0 (+https://github.com/)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_RETRIES) {
        await sleep(REQUEST_PAUSE_MS * attempt);
      }
    }
  }

  throw lastError;
}

async function fetchSource(source) {
  const response = await fetchWithRetry(source.url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${source.name} returned ${response.status}`);
  }

  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(text)) {
    throw new Error(`${source.name} did not return RSS or Atom XML`);
  }

  const articles = parseFeed(text, source);
  if (!articles.length) {
    throw new Error(`${source.name} returned no feed items`);
  }

  return articles;
}

function dedupeAndSort(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles) {
    const urlKey = (article.url || article.title).toLowerCase().replace(/[?#].*$/, "");
    const titleKey = cleanText(article.title)
      .toLowerCase()
      .replace(/\s+-\s+[^-]+$/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (seen.has(urlKey) || seen.has(titleKey)) continue;
    seen.add(urlKey);
    seen.add(titleKey);
    deduped.push(article);
  }

  return deduped
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, CATEGORY_LIMIT);
}

async function fetchCategory(category) {
  const settled = await Promise.allSettled(category.sources.map((source) => fetchSource(source)));
  const articles = [];
  const errors = [];

  settled.forEach((result, index) => {
    const source = category.sources[index];
    if (result.status === "fulfilled") {
      const matchingArticles = result.value.filter((article) => articleMatchesCategory(category, article));
      articles.push(...matchingArticles);
      console.log(`Fetched ${matchingArticles.length} ${category.name} articles from ${source.name}`);
    } else {
      errors.push(result.reason?.message || `${source.name} failed`);
      console.warn(`Could not refresh ${source.name}: ${result.reason?.message || "request failed"}`);
    }
  });

  return {
    articles: dedupeAndSort(articles),
    errors,
  };
}

function articleMatchesCategory(category, article) {
  const haystack = `${article.title} ${article.summary} ${article.source}`;
  if (category.include && !category.include.test(haystack)) return false;
  if (category.exclude && category.exclude.test(haystack)) return false;
  return true;
}

function previousIsUsable(previous) {
  return Array.isArray(previous?.articles) && previous.articles.length > 0;
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

  for (const category of FEEDS) {
    const sourceUrls = category.sources.map((source) => source.url);
    const { articles, errors } = await fetchCategory(category);

    if (articles.length) {
      feeds.push({
        name: category.name,
        sources: sourceUrls,
        articles,
      });
      console.log(`Wrote ${articles.length} ${category.name} articles`);
      continue;
    }

    const previous = existing.feeds?.find((item) => item.name === category.name);
    if (previousIsUsable(previous)) {
      const { error: _error, warning: _warning, ...usablePrevious } = previous;
      feeds.push({
        ...usablePrevious,
        sources: sourceUrls,
        warning: errors.at(-1) || "RSS sources unavailable",
      });
      continue;
    }

    feeds.push({
      name: category.name,
      sources: sourceUrls,
      error: "No cached RSS articles yet.",
      articles: [],
    });
  }

  const payload = {
    source: "RSS",
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
