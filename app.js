const TOKEN_MINT = "27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8";
const DATA_URL = "data/transactions.json";
const SUBSTACK_DATA_URL = "data/infinita-city-times.json";
const NEWS_DATA_URL = "data/news.json";
const SOLSCAN_TX = "https://solscan.io/tx/";
const SOLSCAN_TOKEN = "https://solscan.io/token/";
const NEWS_FEED_NAMES = ["DeSci", "Longevity", "Biotech", "Crypto"];
const FEED_ACCENTS = {
  DeSci: "255, 216, 61",
  Longevity: "255, 159, 28",
  Biotech: "255, 107, 26",
  Crypto: "255, 25, 146",
};
const PULSE_KEYWORDS = [
  { label: "DeSci", terms: ["desci", "decentralized science", "bio protocol"] },
  { label: "Longevity", terms: ["longevity", "aging", "ageing", "lifespan", "rejuvenation"] },
  { label: "Biotech", terms: ["biotech", "biology", "gene", "clinical", "cells", "peptides"] },
  { label: "AI", terms: ["ai", "artificial intelligence", "agents", "model"] },
  { label: "Funding", terms: ["funding", "raises", "venture", "series", "investment", "startup"] },
  { label: "Crypto", terms: ["crypto", "bitcoin", "token", "protocol", "web3"] },
];
const HEATMAP_SIGNALS = [
  { label: "AI", terms: ["ai", "artificial intelligence", "agents", "model"] },
  { label: "Funding", terms: ["funding", "raises", "venture", "series", "investment", "startup"] },
  { label: "Research", terms: ["research", "study", "trial", "paper", "clinical", "arxiv", "nature"] },
  { label: "Longevity", terms: ["longevity", "aging", "ageing", "lifespan", "reprogramming", "peptide"] },
  { label: "Market", terms: ["crypto", "bitcoin", "token", "surge", "price", "protocol"] },
];
const HOUR = 60 * 60 * 1000;
const SUBSTACK_FALLBACK = {
  source: "Bundled fallback",
  items: [
    {
      title: "Infinita Newsletter: April '26",
      link: "https://www.infinitacitytimes.com/p/infinita-newsletter-april-26",
      date: "Tue, 21 Apr 2026 16:59:13 GMT",
      summary: "Hi friends!",
    },
    {
      title: "Ep. 107: Sid Sijbrandij On Beating Cancer with First Principles, n = 1 Personalized Treatments and Special Access Regulatory Pathways",
      link: "https://www.infinitacitytimes.com/p/ep-107-sid-sijbrandij-on-beating",
      date: "Fri, 10 Apr 2026 16:28:46 GMT",
      summary: "He Got Cancer... So He Built His Own Treatment",
    },
    {
      title: "The World is Ready for Liberty Acceleration",
      link: "https://www.infinitacitytimes.com/p/the-world-is-ready-for-liberty-acceleration",
      date: "Wed, 08 Apr 2026 18:22:12 GMT",
      summary: "Concluding the first summit of its kind: lib/acc 2026",
    },
  ],
};

const elements = {
  status: document.querySelector("#networkStatus"),
  loaded: document.querySelector("#loadedValue"),
  updated: document.querySelector("#updatedValue"),
  notice: document.querySelector("#notice"),
  body: document.querySelector("#transactionsBody"),
  graph: document.querySelector("#transactionGraph"),
  graphCount: document.querySelector("#graphCountValue"),
  news: document.querySelector("#newsFeeds"),
  infinita: document.querySelector("#infinitaFeed"),
  newsUpdated: document.querySelector("#newsUpdatedValue"),
  narrative: document.querySelector("#narrativePulse"),
  heatmap: document.querySelector("#signalHeatmap"),
  timeline: document.querySelector("#signalTimeline"),
  briefing: document.querySelector("#commandBriefing"),
};

let allRows = [];
let latestNewsPayload = null;
let latestSubstackPayload = null;
let graphAnimation;
let graphHits = [];

function setStatus(text, state = "") {
  elements.status.textContent = text;
  elements.status.className = `status-pill ${state}`.trim();
}

function setNotice(message) {
  elements.notice.hidden = !message;
  elements.notice.textContent = message || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function articleText(article) {
  return cleanText(`${article?.title || ""} ${article?.summary || ""} ${article?.source || ""}`).toLowerCase();
}

function termAppears(text, term) {
  const cleanedTerm = String(term).toLowerCase();
  if (cleanedTerm.length <= 3) {
    return new RegExp(`\\b${escapeRegExp(cleanedTerm)}\\b`, "i").test(text);
  }
  return text.includes(cleanedTerm);
}

function countSignalHits(text, terms) {
  return terms.reduce((total, term) => total + (termAppears(text, term) ? 1 : 0), 0);
}

function shortAddress(value) {
  if (!value) return "--";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatDate(seconds) {
  if (!seconds) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(seconds * 1000));
}

function formatNumber(value, maximumFractionDigits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value || "--";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(numeric);
}

function transactionColor(index, total) {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  const stops = [
    { at: 0, rgb: [255, 216, 61] },
    { at: 0.45, rgb: [255, 159, 28] },
    { at: 1, rgb: [255, 25, 146] },
  ];
  const right = stops.find((stop) => ratio <= stop.at) || stops[stops.length - 1];
  const left = stops[Math.max(0, stops.indexOf(right) - 1)];
  const span = Math.max(0.001, right.at - left.at);
  const local = Math.max(0, Math.min(1, (ratio - left.at) / span));
  const rgb = left.rgb.map((channel, channelIndex) => Math.round(channel + (right.rgb[channelIndex] - channel) * local));
  return rgb;
}

function colorWithAlpha(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function drawLivesLogo(ctx, centerX, centerY, unit) {
  const blocks = [
    [1, 0, 2, 1, "#ffd83d"],
    [4, 0, 2, 1, "#ffd83d"],
    [0, 1, 1, 1, "#ffb21a"],
    [3, 1, 1, 1, "#ffb21a"],
    [6, 1, 1, 1, "#ffb21a"],
    [0, 2, 1, 1, "#ff8a13"],
    [6, 2, 1, 1, "#ff8a13"],
    [0, 3, 1, 1, "#ff5a0a"],
    [6, 3, 1, 1, "#ff5a0a"],
    [1, 4, 2, 1, "#f20c08"],
    [5, 4, 1, 1, "#f20c08"],
    [2, 5, 1, 1, "#f00098"],
    [3, 5, 1, 1, "#f00098"],
    [5, 5, 1, 1, "#f00098"],
    [3, 6, 1, 1, "#f00098"],
  ];
  const width = 7 * unit;
  const height = 7 * unit;
  const left = centerX - width / 2;
  const top = centerY - height / 2;

  ctx.save();
  ctx.shadowColor = "rgba(255, 25, 146, 0.55)";
  ctx.shadowBlur = unit * 1.4;
  blocks.forEach(([x, y, w, h, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(left + x * unit, top + y * unit, w * unit, h * unit);
  });
  ctx.restore();
}

function formatNewsDate(value) {
  if (!value) return "--";
  const text = String(value);
  const compactDateMatch = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  const isoLike = compactDateMatch
    ? `${compactDateMatch[1]}-${compactDateMatch[2]}-${compactDateMatch[3]}T${compactDateMatch[4] || "00"}:${compactDateMatch[5] || "00"}:${compactDateMatch[6] || "00"}Z`
    : text;
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatAnyDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatNewsDate(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceDomain(article) {
  if (article.domain) return article.domain;
  try {
    return new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    return "--";
  }
}

function renderMeta(payload) {
  elements.updated.textContent = payload.updatedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.updatedAt))
    : "--";
}

function renderRows() {
  const rows = allRows.slice(0, 20);

  elements.loaded.textContent = String(allRows.length);

  if (!rows.length) {
    elements.body.innerHTML = '<tr><td colspan="6" class="empty">No transfers found.</td></tr>';
    return;
  }

  elements.body.innerHTML = rows
    .map((row) => {
      const signature = escapeHtml(row.signature);
      const from = escapeHtml(row.from);
      const to = escapeHtml(row.to);
      return `
        <tr>
          <td>
            <div>${formatDate(row.blockTime)}</div>
            <div class="muted">Slot ${escapeHtml(row.slot || "--")}</div>
          </td>
          <td><span class="chip chip-transfer">${escapeHtml(row.type)}</span></td>
          <td class="amount positive">${escapeHtml(row.amountText)}</td>
          <td class="mono" title="${from}">${from ? shortAddress(from) : "--"}</td>
          <td class="mono" title="${to}">${to ? shortAddress(to) : "--"}</td>
          <td class="mono">
            <a href="${SOLSCAN_TX}${signature}" target="_blank" rel="noreferrer">${shortAddress(signature)}</a>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderGraph() {
  const canvas = elements.graph;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const center = { x: 86, y: height / 2 };
  const rows = allRows.filter((row) => row.signature).slice(0, 100);
  graphHits = [];

  elements.graphCount.textContent = `${rows.length} tx`;

  const graphLeft = width < 520 ? 132 : 185;
  const graphRight = width - (width < 760 ? 32 : 96);
  const txPoints = rows.map((row, index) => {
    const laneCount = 4;
    const colCount = Math.ceil(rows.length / laneCount);
    const col = index % colCount;
    const lane = Math.floor(index / colCount);
    const left = graphLeft;
    const right = graphRight;
    const x = colCount <= 1 ? left : left + (col / (colCount - 1)) * (right - left);
    const laneOffsets = [-54, -18, 18, 54];
    const wave = Math.sin(index * 0.72) * 10;
    const y = height / 2 + laneOffsets[lane] + wave;
    const point = { ...row, index, x, y };
    graphHits.push({
      signature: row.signature,
      x,
      y,
      radius: 13,
    });
    return point;
  });

  window.cancelAnimationFrame(graphAnimation);
  const started = performance.now();

  function draw(now) {
    const pulse = (Math.sin((now - started) / 620) + 1) / 2;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#070707";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 25, 146, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 44) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.beginPath();
    txPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(244, 244, 245, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();

    txPoints.forEach((point) => {
      const freshness = Math.max(0.2, 1 - point.index / 100);
      const color = transactionColor(point.index, txPoints.length);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 9 + pulse * 1.2, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(color, 0.36 + freshness * 0.42);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(color, 0.45 + freshness * 0.38);
      ctx.fill();
    });

    ctx.beginPath();
    ctx.arc(center.x, center.y, 43 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 25, 146, 0.09)";
    ctx.fill();
    drawLivesLogo(ctx, center.x, center.y - 2, 11);
    ctx.fillStyle = "rgba(255, 216, 61, 0.92)";
    ctx.font = "900 12px SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NEWEST  ->  OLDEST", center.x + 8, center.y + 56);
    ctx.strokeStyle = "rgba(255, 159, 28, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center.x - 46, center.y + 40);
    ctx.lineTo(center.x + 62, center.y + 40);
    ctx.stroke();
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(center.x - 64, center.y + 72, 144, 44, 8);
    } else {
      ctx.rect(center.x - 64, center.y + 72, 144, 44);
    }
    ctx.fillStyle = "rgba(255, 25, 146, 0.14)";
    ctx.strokeStyle = `rgba(255, 216, 61, ${0.54 + pulse * 0.24})`;
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 216, 61, 0.97)";
    ctx.font = "900 12px SFMono-Regular, Consolas, monospace";
    ctx.fillText("CLICK A DOT", center.x + 8, center.y + 88);
    ctx.fillStyle = "rgba(255, 25, 146, 0.98)";
    ctx.font = "900 10px SFMono-Regular, Consolas, monospace";
    ctx.fillText("TO SEE TRANSACTION", center.x + 8, center.y + 104);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    graphAnimation = window.requestAnimationFrame(draw);
  }

  graphAnimation = window.requestAnimationFrame(draw);
}

function graphPointerPosition(event) {
  const rect = elements.graph.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function graphHitAt(event) {
  const point = graphPointerPosition(event);
  return graphHits.find((hit) => {
    const dx = hit.x - point.x;
    const dy = hit.y - point.y;
    return Math.sqrt(dx * dx + dy * dy) <= hit.radius;
  });
}

async function loadTokenData() {
  setStatus("Loading", "loading");
  setNotice("");
  elements.body.innerHTML = '<tr><td colspan="6" class="empty">Loading cached transfers...</td></tr>';

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Could not load ${DATA_URL} (${response.status})`);
    }

    const payload = await response.json();
    allRows = payload.transactions || [];
    renderMeta(payload);
    renderRows();
    renderGraph();
    renderSignalIntel();
    setStatus("Live", "loading");

  } catch (error) {
    console.error(error);
    setStatus("Error", "error");
    elements.body.innerHTML = '<tr><td colspan="6" class="empty">Could not load cached token transfers.</td></tr>';
    setNotice(`${error.message}. Run the GitHub Actions data updater or open this through a local/static server so data/transactions.json can be fetched.`);
  }
}

function renderNewsLoading() {
  elements.news.innerHTML = NEWS_FEED_NAMES
    .map((name) => `
      <section class="feed-card">
        <h3>${escapeHtml(name)}</h3>
        <div class="feed-state">Loading...</div>
      </section>
    `)
    .join("");
  renderSignalIntel();
}

function renderInfinitaLoading() {
  elements.infinita.innerHTML = '<div class="feed-state">Loading...</div>';
}

function renderFeed(feed, articles, error = "") {
  const sortedArticles = [...articles].sort((a, b) => {
    const left = Date.parse(formatNewsDateForSort(a.seendate || a.date));
    const right = Date.parse(formatNewsDateForSort(b.seendate || b.date));
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left);
  });
  const lead = sortedArticles[0];
  const rest = sortedArticles.slice(1);
  const note = error && sortedArticles.length
    ? '<div class="feed-note">Showing cached articles while this signal refreshes.</div>'
    : "";
  const content = sortedArticles.length
    ? `${note}${lead ? `
          <article class="lead-article">
            <a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(cleanText(lead.title) || "Untitled")}</a>
            <div class="article-meta">
              <span>${escapeHtml(sourceDomain(lead))}</span>
              <span>${escapeHtml(formatNewsDate(lead.seendate || lead.date))}</span>
            </div>
          </article>
        ` : ""}
        <ol class="article-list">
          ${rest.map((article) => `
            <li>
              <a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">${escapeHtml(cleanText(article.title) || "Untitled")}</a>
              <div class="article-meta">
                <span>${escapeHtml(sourceDomain(article))}</span>
                <span>${escapeHtml(formatNewsDate(article.seendate || article.date))}</span>
              </div>
            </li>
          `).join("")}
        </ol>`
    : `<div class="feed-state">${escapeHtml(error ? "No cached articles for this signal yet." : "No articles found.")}</div>`;

  return `
    <section class="feed-card">
      <h3>${escapeHtml(feed.name)}</h3>
      ${content}
    </section>
  `;
}

function formatNewsDateForSort(value) {
  if (!value) return "";
  const text = String(value);
  const compactDateMatch = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  return compactDateMatch
    ? `${compactDateMatch[1]}-${compactDateMatch[2]}-${compactDateMatch[3]}T${compactDateMatch[4] || "00"}:${compactDateMatch[5] || "00"}:${compactDateMatch[6] || "00"}Z`
    : text;
}

async function loadNewsFeeds() {
  renderNewsLoading();
  renderInfinitaLoading();
  const [newsResult, substackResult] = await Promise.all([
    fetchNewsCache().then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
    fetchSubstackFeed().then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
  ]);

  const newsCards = newsResult.status === "fulfilled"
    ? renderNewsCache(newsResult.value)
    : `<section class="feed-card feed-card-wide">
        <h3>News cache needs refresh</h3>
        <div class="feed-state error-text">${escapeHtml(newsResult.reason?.message || "Could not load cached news.")}</div>
      </section>`;
  latestNewsPayload = newsResult.status === "fulfilled" ? newsResult.value : null;
  latestSubstackPayload = substackResult.status === "fulfilled" ? substackResult.value : null;

  elements.infinita.innerHTML = substackResult.status === "fulfilled"
    ? renderSubstackFeed(substackResult.value)
    : renderSubstackFeed(null, substackResult.reason?.message || "Could not load Infinita City Times.");

  elements.news.innerHTML = newsCards;
  const updatedAt = newsResult.status === "fulfilled" ? newsResult.value.updatedAt : new Date();
  elements.newsUpdated.textContent = formatAnyDate(updatedAt);
  renderSignalIntel(newsResult.status === "rejected" ? newsResult.reason?.message : "");
}

async function fetchNewsCache() {
  const response = await fetch(`${NEWS_DATA_URL}?t=${Date.now()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`News cache returned ${response.status}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const hasConflictMarkers = text.includes("<<<<<<<") || text.includes("=======") || text.includes(">>>>>>>");
    if (hasConflictMarkers) {
      throw new Error(`News cache has git conflict markers. Regenerate ${NEWS_DATA_URL} with scripts/update-news.mjs, or discard the local generated cache before pulling.`);
    }
    throw new Error(`News cache is invalid JSON. Regenerate ${NEWS_DATA_URL} with scripts/update-news.mjs.`);
  }
}

function renderNewsCache(payload) {
  const feeds = payload.feeds || [];
  return NEWS_FEED_NAMES
    .map((name) => {
      const feed = feeds.find((item) => item.name === name) || { name, articles: [] };
      return renderFeed(feed, feed.articles || [], feed.error || feed.warning || "");
    })
    .join("");
}

function newsFeedsFromPayload(payload) {
  const feeds = payload?.feeds || [];
  return NEWS_FEED_NAMES.map((name) => {
    const feed = feeds.find((item) => item.name === name) || { name, articles: [] };
    return {
      ...feed,
      name,
      articles: feed.articles || [],
    };
  });
}

function articleTimestamp(article) {
  const parsed = Date.parse(formatNewsDateForSort(article?.seendate || article?.date || article?.pubDate));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function eventTimeLabel(time) {
  if (!time) return "CACHE";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));
}

function eventDateLabel(time) {
  if (!time) return "Cache";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(time));
}

function keywordCounts(articles, groups) {
  return groups
    .map((group) => {
      const count = articles.reduce((total, article) => total + countSignalHits(articleText(article), group.terms), 0);
      return { ...group, count };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count);
}

function articleSignalLabels(article) {
  const text = articleText(article);
  return PULSE_KEYWORDS
    .filter((group) => countSignalHits(text, group.terms) > 0)
    .map((group) => group.label);
}

function crossoverSignals(articles) {
  const pairs = new Map();
  articles.forEach((article) => {
    const labels = [...new Set(articleSignalLabels(article))];
    labels.forEach((left, leftIndex) => {
      labels.slice(leftIndex + 1).forEach((right) => {
        const pair = [left, right].sort().join(" + ");
        pairs.set(pair, (pairs.get(pair) || 0) + 1);
      });
    });
  });
  return [...pairs.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function transactionPulseStats() {
  const rows = allRows.filter((row) => row.blockTime);
  const newest = rows.reduce((latest, row) => Math.max(latest, row.blockTime * 1000), 0);
  const cutoff = newest - 24 * HOUR;
  const recentRows = newest ? rows.filter((row) => row.blockTime * 1000 >= cutoff) : [];
  const amount = recentRows.reduce((total, row) => {
    const value = Number(String(row.amountText || "").replace(/,/g, ""));
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    count: recentRows.length,
    amount,
    newest,
  };
}

function feedFreshness(feeds, anchorTime) {
  const cutoff = anchorTime - 72 * HOUR;
  return feeds
    .map((feed) => ({
      name: feed.name,
      count: feed.articles.filter((article) => articleTimestamp(article) >= cutoff).length,
      total: feed.articles.length,
    }))
    .sort((a, b) => b.count - a.count || b.total - a.total);
}

function substackItemsFromPayload(payload) {
  return (payload?.items || []).map((item) => ({
    ...item,
    time: Date.parse(item.date) || 0,
  }));
}

function buildTimelineEntries(articles, substackItems) {
  const newsEntries = [...articles]
    .sort((a, b) => articleTimestamp(b) - articleTimestamp(a))
    .slice(0, 10)
    .map((article) => ({
      type: "RSS",
      label: article.feed,
      title: cleanText(article.title) || "Untitled signal",
      meta: sourceDomain(article),
      time: articleTimestamp(article),
      href: article.url,
    }));
  const infinitaEntries = substackItems.slice(0, 4).map((item) => ({
    type: "Infinita",
    label: "Infinita",
    title: cleanText(item.title) || "Infinita City Times update",
    meta: "infinitacitytimes.com",
    time: item.time,
    href: item.link,
  }));
  const transferEntries = allRows.slice(0, 8).map((row) => ({
    type: "Transfer",
    label: "$LIVES",
    title: `${formatNumber(row.amountText, 2)} $LIVES transfer`,
    meta: `${shortAddress(row.from)} -> ${shortAddress(row.to)}`,
    time: row.blockTime ? row.blockTime * 1000 : 0,
    href: row.signature ? `${SOLSCAN_TX}${row.signature}` : "",
  }));
  return [...newsEntries, ...infinitaEntries, ...transferEntries]
    .filter((entry) => entry.title)
    .sort((a, b) => b.time - a.time)
    .slice(0, 14);
}

function renderSignalIntel(error = "") {
  const intelTargets = [elements.narrative, elements.heatmap, elements.timeline, elements.briefing].filter(Boolean);
  if (!intelTargets.length) return;

  if (error) {
    const message = escapeHtml(error);
    intelTargets.forEach((target) => {
      target.innerHTML = `<div class="feed-state error-text">${message}</div>`;
    });
    return;
  }

  if (!latestNewsPayload) {
    if (elements.narrative) elements.narrative.innerHTML = '<div class="feed-state">Loading signal pulse...</div>';
    if (elements.heatmap) elements.heatmap.innerHTML = '<div class="feed-state">Loading heatmap...</div>';
    if (elements.timeline) elements.timeline.innerHTML = '<div class="feed-state">Loading signal timeline...</div>';
    if (elements.briefing) elements.briefing.innerHTML = '<div class="feed-state">Loading command briefing...</div>';
    return;
  }

  const feeds = newsFeedsFromPayload(latestNewsPayload);
  const articles = feeds.flatMap((feed) => feed.articles.map((article) => ({ ...article, feed: feed.name })));
  const substackItems = substackItemsFromPayload(latestSubstackPayload);
  if (!articles.length) {
    intelTargets.forEach((target) => {
      target.innerHTML = '<div class="feed-state">No signal articles found.</div>';
    });
    return;
  }

  const anchorTime = Math.max(...articles.map(articleTimestamp), Date.parse(latestNewsPayload.updatedAt) || 0);
  const hotTerms = keywordCounts(articles, PULSE_KEYWORDS);
  const crossovers = crossoverSignals(articles);
  const freshness = feedFreshness(feeds, anchorTime);
  const txStats = transactionPulseStats();
  const newestArticle = [...articles].sort((a, b) => articleTimestamp(b) - articleTimestamp(a))[0];

  elements.narrative.innerHTML = renderNarrativePulse({
    articles,
    newestArticle,
    hotTerms,
    crossovers,
    freshness,
    txStats,
  });
  elements.heatmap.innerHTML = renderSignalHeatmap(feeds);
  if (elements.timeline) {
    elements.timeline.innerHTML = renderSignalTimeline(buildTimelineEntries(articles, substackItems));
  }
  if (elements.briefing) {
    elements.briefing.innerHTML = renderCommandBriefing({
      articles,
      newestArticle,
      hotTerms,
      crossovers,
      freshness,
      txStats,
      substackItems,
    });
  }
}

function renderNarrativePulse({ articles, newestArticle, hotTerms, crossovers, freshness, txStats }) {
  const topTerm = hotTerms[0] || { label: "Scanning", count: 0 };
  const topCrossover = crossovers[0];
  const topFeed = freshness[0] || { name: "Feeds", count: 0, total: 0 };
  const txLabel = txStats.count ? `${txStats.count} tx / ${formatNumber(txStats.amount, 2)} $LIVES` : "Waiting for tx cache";
  const events = [
    newestArticle && {
      time: eventTimeLabel(articleTimestamp(newestArticle)),
      text: `Latest ${newestArticle.feed}: ${cleanText(newestArticle.title)}`,
    },
    topTerm.count && {
      time: "NOW",
      text: `${topTerm.label} is the loudest term cluster with ${topTerm.count} hits`,
    },
    topCrossover && {
      time: "XOVER",
      text: `${topCrossover.label} overlap appears in ${topCrossover.count} articles`,
    },
    topFeed.total && {
      time: "72H",
      text: `${topFeed.name} has ${topFeed.count} fresh items in the cache window`,
    },
    txStats.count && {
      time: eventTimeLabel(txStats.newest),
      text: `$LIVES flow shows ${txLabel}`,
    },
  ].filter(Boolean).slice(0, 5);

  return `
    <div class="pulse-layout">
      <div class="pulse-lead">
        <span class="pulse-label">Top signal</span>
        <strong>${escapeHtml(topTerm.label)}</strong>
        <p>${escapeHtml(topTerm.count ? `${topTerm.count} keyword hits across ${articles.length} cached articles.` : "Scanning cached feeds for a dominant narrative.")}</p>
        <div class="hot-terms" aria-label="Hot terms">
          ${hotTerms.slice(0, 5).map((term) => `
            <span>${escapeHtml(term.label)} <b>${escapeHtml(term.count)}</b></span>
          `).join("") || "<span>No terms yet</span>"}
        </div>
      </div>
      <div class="pulse-stats" aria-label="Pulse stats">
        <div>
          <span>Articles</span>
          <strong>${escapeHtml(articles.length)}</strong>
        </div>
        <div>
          <span>Crossover</span>
          <strong>${escapeHtml(topCrossover ? topCrossover.label : "Quiet")}</strong>
        </div>
        <div>
          <span>Transfers 24h</span>
          <strong>${escapeHtml(txStats.count ? String(txStats.count) : "--")}</strong>
        </div>
      </div>
      <ol class="pulse-stream" aria-label="Narrative events">
        ${events.map((event) => `
          <li>
            <span>${escapeHtml(event.time)}</span>
            <p>${escapeHtml(event.text)}</p>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function renderSignalHeatmap(feeds) {
  const matrix = HEATMAP_SIGNALS.map((signal) => ({
    ...signal,
    cells: feeds.map((feed) => {
      const count = feed.articles.reduce((total, article) => total + countSignalHits(articleText(article), signal.terms), 0);
      return { feed: feed.name, count };
    }),
  }));
  const maxCount = Math.max(1, ...matrix.flatMap((row) => row.cells.map((cell) => cell.count)));
  const peak = matrix
    .flatMap((row) => row.cells.map((cell) => ({ signal: row.label, ...cell })))
    .sort((a, b) => b.count - a.count)[0];

  return `
    <div class="heatmap-summary">
      <span>Peak</span>
      <strong>${escapeHtml(peak?.count ? `${peak.feed} / ${peak.signal}` : "Scanning")}</strong>
      <em>${escapeHtml(peak?.count ? `${peak.count} hits` : "No hits yet")}</em>
    </div>
    <div class="heatmap-matrix" role="table" aria-label="Signal heatmap by RSS feed">
      <div class="heatmap-corner" role="columnheader">Signal</div>
      ${feeds.map((feed) => `
        <div class="heatmap-head" role="columnheader" style="--accent-rgb: ${FEED_ACCENTS[feed.name] || FEED_ACCENTS.Crypto};">${escapeHtml(feed.name)}</div>
      `).join("")}
      ${matrix.map((row) => `
        <div class="heatmap-row-label" role="rowheader">${escapeHtml(row.label)}</div>
        ${row.cells.map((cell) => {
          const intensity = cell.count / maxCount;
          const accent = FEED_ACCENTS[cell.feed] || FEED_ACCENTS.Crypto;
          const fillAlpha = (0.06 + intensity * 0.36).toFixed(2);
          const borderAlpha = (0.16 + intensity * 0.46).toFixed(2);
          return `
            <div
              class="heatmap-cell"
              role="cell"
              style="--heat: ${intensity.toFixed(2)}; --accent-rgb: ${accent}; background: rgba(${accent}, ${fillAlpha}); border-color: rgba(${accent}, ${borderAlpha});"
            >
              <strong>${escapeHtml(cell.count)}</strong>
              <span>hits</span>
              <i></i>
            </div>
          `;
        }).join("")}
      `).join("")}
    </div>
  `;
}

function renderSignalTimeline(entries) {
  if (!entries.length) {
    return '<div class="feed-state">No timeline entries found.</div>';
  }
  return `
    <div class="timeline-rail" aria-label="Merged signal timeline">
      ${entries.map((entry, index) => {
        const content = `
          <span class="timeline-type">${escapeHtml(entry.label)}</span>
          <strong>${escapeHtml(entry.title)}</strong>
          <em>${escapeHtml(eventDateLabel(entry.time))} / ${escapeHtml(entry.meta || entry.type)}</em>
        `;
        return entry.href
          ? `<a class="timeline-entry" href="${escapeHtml(entry.href)}" target="_blank" rel="noreferrer" style="--entry-index: ${index};">${content}</a>`
          : `<article class="timeline-entry" style="--entry-index: ${index};">${content}</article>`;
      }).join("")}
    </div>
  `;
}

function renderCommandBriefing({ articles, newestArticle, hotTerms, crossovers, freshness, txStats, substackItems }) {
  const topTerm = hotTerms[0] || { label: "Scanning", count: 0 };
  const topCrossover = crossovers[0];
  const topFeed = freshness[0] || { name: "Feeds", count: 0, total: 0 };
  const leadSubstack = substackItems[0];
  const newestTransfer = allRows.find((row) => row.signature);
  const watchTerms = hotTerms.slice(1, 4).map((term) => term.label);
  const currentState = txStats.count && topTerm.count ? "Active signal window" : "Building cache";
  const openLeads = [
    leadSubstack && {
      label: "Infinita",
      title: leadSubstack.title,
      href: leadSubstack.link,
    },
    newestArticle && {
      label: newestArticle.feed,
      title: newestArticle.title,
      href: newestArticle.url,
    },
    newestTransfer && {
      label: "$LIVES",
      title: `${formatNumber(newestTransfer.amountText, 2)} $LIVES transfer`,
      href: `${SOLSCAN_TX}${newestTransfer.signature}`,
    },
  ].filter(Boolean);

  return `
    <div class="briefing-grid">
      <section class="briefing-primary">
        <span>Current state</span>
        <strong>${escapeHtml(currentState)}</strong>
        <p>${escapeHtml(`${topFeed.name} is carrying the freshest RSS density while ${topTerm.label} leads the narrative pulse.`)}</p>
      </section>
      <section class="briefing-card">
        <span>Top narrative</span>
        <strong>${escapeHtml(topCrossover ? topCrossover.label : topTerm.label)}</strong>
        <p>${escapeHtml(topCrossover ? `${topCrossover.count} crossover hits in cached articles.` : `${topTerm.count} keyword hits across ${articles.length} articles.`)}</p>
      </section>
      <section class="briefing-card">
        <span>Watch next</span>
        <strong>${escapeHtml(watchTerms.join(" / ") || "RSS refresh")}</strong>
        <p>${escapeHtml(`${articles.length} cached articles, ${txStats.count || 0} transfers in the latest 24h window.`)}</p>
      </section>
      <section class="briefing-card">
        <span>Latest movement</span>
        <strong>${escapeHtml(txStats.count ? `${txStats.count} transfers` : "No transfer pulse")}</strong>
        <p>${escapeHtml(txStats.count ? `${formatNumber(txStats.amount, 2)} $LIVES moved in the latest 24h cache window.` : "Waiting for transaction cache.")}</p>
      </section>
      <section class="briefing-leads" aria-label="Open leads">
        <span>Open leads</span>
        ${openLeads.map((lead) => `
          <a href="${escapeHtml(lead.href)}" target="_blank" rel="noreferrer">
            <b>${escapeHtml(lead.label)}</b>
            <strong>${escapeHtml(cleanText(lead.title) || "Open lead")}</strong>
          </a>
        `).join("")}
      </section>
    </div>
  `;
}

async function fetchSubstackFeed() {
  try {
    const response = await fetch(`${SUBSTACK_DATA_URL}?t=${Date.now()}`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Substack cache returned ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.warn(`Using bundled Infinita City Times fallback: ${error.message}`);
    return {
      ...SUBSTACK_FALLBACK,
      error: error.message,
    };
  }
}

function renderSubstackFeed(payload, error = "") {
  const items = payload?.items || [];
  const lead = items[0];
  const rest = items.slice(1, 12);
  const content = error
    ? `<div class="feed-state error-text">${escapeHtml(error)}</div>`
    : items.length
      ? `${lead ? `
          <article class="lead-article">
            <a href="${escapeHtml(lead.link)}" target="_blank" rel="noreferrer">${escapeHtml(cleanText(lead.title) || "Untitled")}</a>
            <p>${escapeHtml(cleanText(lead.summary))}</p>
            <div class="article-meta">
              <span>infinitacitytimes.com</span>
              <span>${escapeHtml(formatAnyDate(lead.date))}</span>
            </div>
          </article>
        ` : ""}
        <ol class="article-list">
          ${rest.map((item) => `
            <li>
              <a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(cleanText(item.title) || "Untitled")}</a>
              <div class="article-meta">
                <span>infinitacitytimes.com</span>
                <span>${escapeHtml(formatAnyDate(item.date))}</span>
              </div>
            </li>
          `).join("")}
        </ol>`
      : '<div class="feed-state">No posts found.</div>';

  return `
    ${payload?.error ? `<div class="feed-note">Using bundled fallback until the static feed cache is available.</div>` : ""}
    ${content}
  `;
}

function loadAll() {
  loadTokenData();
  loadNewsFeeds();
}

document.querySelectorAll(".section-tabs a").forEach((link) => {
  link.addEventListener("click", () => {
    const target = document.querySelector(`#${link.dataset.target}`);
    if (!target) return;
    target.classList.remove("section-glow");
    void target.offsetWidth;
    target.classList.add("section-glow");
window.setTimeout(() => target.classList.remove("section-glow"), 4000);
  });
});

window.addEventListener("resize", () => renderGraph());

elements.graph?.addEventListener("mousemove", (event) => {
  elements.graph.style.cursor = graphHitAt(event) ? "pointer" : "default";
});

elements.graph?.addEventListener("click", (event) => {
  const hit = graphHitAt(event);
  if (hit?.signature) {
    window.open(`${SOLSCAN_TX}${hit.signature}`, "_blank", "noopener,noreferrer");
  }
});

loadAll();
