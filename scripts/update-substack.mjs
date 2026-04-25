import { mkdir, readFile, writeFile } from "node:fs/promises";

const FEED_URL = "https://www.infinitacitytimes.com/feed";
const OUTFILE = "data/infinita-city-times.json";

function textFrom(node, tagName) {
  const match = node.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match) return "";
  return decode(match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .trim());
}

function decode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  let payload;

  try {
    const response = await fetch(FEED_URL, {
      headers: { accept: "application/rss+xml, application/xml, text/xml" },
    });

    if (!response.ok) {
      throw new Error(`Substack feed request failed with HTTP ${response.status}`);
    }

    const xml = await response.text();
    const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
      .slice(0, 10)
      .map((match) => {
        const item = match[0];
        return {
          title: textFrom(item, "title"),
          link: textFrom(item, "link"),
          date: textFrom(item, "pubDate"),
          summary: textFrom(item, "description"),
        };
      });

    payload = {
      source: "Infinita City Times",
      feed: FEED_URL,
      updatedAt: new Date().toISOString(),
      items,
    };
  } catch (error) {
    console.warn(`Keeping existing Substack cache: ${error.message}`);
    payload = JSON.parse(await readFile(OUTFILE, "utf8"));
    payload.error = error.message;
  }

  await mkdir("data", { recursive: true });
  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTFILE} with ${items.length} posts`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
