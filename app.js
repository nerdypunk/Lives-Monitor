const TOKEN_MINT = "27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8";
const DATA_URL = "data/transactions.json";
const SUBSTACK_DATA_URL = "data/infinita-city-times.json";
const NEWS_DATA_URL = "data/news.json";
const SOLSCAN_TX = "https://solscan.io/tx/";
const SOLSCAN_TOKEN = "https://solscan.io/token/";
const NEWS_FEED_NAMES = ["DeSci", "Longevity", "Biotech", "Crypto"];
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
  tokenName: document.querySelector("#tokenNameValue"),
  supply: document.querySelector("#supplyValue"),
  daily: document.querySelector("#dailyValue"),
  loaded: document.querySelector("#loadedValue"),
  updated: document.querySelector("#updatedValue"),
  notice: document.querySelector("#notice"),
  body: document.querySelector("#transactionsBody"),
  graph: document.querySelector("#transactionGraph"),
  graphCount: document.querySelector("#graphCountValue"),
  news: document.querySelector("#newsFeeds"),
  infinita: document.querySelector("#infinitaFeed"),
  newsUpdated: document.querySelector("#newsUpdatedValue"),
};

let allRows = [];
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
  const token = payload.token || {};
  const symbol = token.symbol && token.symbol !== "Token" ? token.symbol : "$LIVES";
  const name = token.name && token.name !== "Token" ? `${token.name} (${symbol})` : symbol;
  elements.tokenName.innerHTML = `<a href="${SOLSCAN_TOKEN}${TOKEN_MINT}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`;
  elements.supply.textContent = formatNumber(token.supply, 4);
  elements.daily.textContent = formatNumber(payload.stats?.last24h ?? 0, 0);
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
        <h3>News cache unavailable</h3>
        <div class="feed-state error-text">${escapeHtml(newsResult.reason?.message || "Could not load cached news.")}</div>
      </section>`;

  elements.infinita.innerHTML = substackResult.status === "fulfilled"
    ? renderSubstackFeed(substackResult.value)
    : renderSubstackFeed(null, substackResult.reason?.message || "Could not load Infinita City Times.");

  elements.news.innerHTML = newsCards;
  const updatedAt = newsResult.status === "fulfilled" ? newsResult.value.updatedAt : new Date();
  elements.newsUpdated.textContent = formatAnyDate(updatedAt);
}

async function fetchNewsCache() {
  const response = await fetch(`${NEWS_DATA_URL}?t=${Date.now()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`News cache returned ${response.status}`);
  }
  return response.json();
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
