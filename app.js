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
  limit: document.querySelector("#limitSelect"),
  refresh: document.querySelector("#refreshButton"),
  prev: document.querySelector("#prevButton"),
  next: document.querySelector("#nextButton"),
  notice: document.querySelector("#notice"),
  body: document.querySelector("#transactionsBody"),
  graph: document.querySelector("#transactionGraph"),
  graphCount: document.querySelector("#graphCountValue"),
  news: document.querySelector("#newsFeeds"),
  infinita: document.querySelector("#infinitaFeed"),
  newsUpdated: document.querySelector("#newsUpdatedValue"),
};

let page = 1;
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

function formatNewsDate(value) {
  if (!value) return "--";
  const text = String(value);
  const gdeltMatch = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  const isoLike = gdeltMatch
    ? `${gdeltMatch[1]}-${gdeltMatch[2]}-${gdeltMatch[3]}T${gdeltMatch[4] || "00"}:${gdeltMatch[5] || "00"}:${gdeltMatch[6] || "00"}Z`
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
  const limit = Number(elements.limit.value);
  const start = (page - 1) * limit;
  const rows = allRows.slice(start, start + limit);

  elements.loaded.textContent = String(allRows.length);
  elements.prev.disabled = page <= 1;
  elements.next.disabled = start + limit >= allRows.length;

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
          <td><span class="chip">${escapeHtml(row.type)}</span></td>
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

function walletLabel(value) {
  if (!value) return "";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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
  const wallets = new Map();
  graphHits = [];

  rows.forEach((row, index) => {
    const from = row.from || "";
    const to = row.to || "";
    if (from) wallets.set(from, { id: from, weight: (wallets.get(from)?.weight || 0) + 1 });
    if (to) wallets.set(to, { id: to, weight: (wallets.get(to)?.weight || 0) + 1 });
  });

  const walletList = [...wallets.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  elements.graphCount.textContent = `${rows.length} tx / ${walletList.length} wallets`;

  const walletRadiusX = Math.max(180, width * 0.39);
  const walletRadiusY = Math.max(80, height * 0.31);
  const walletCenter = { x: width * 0.58, y: height / 2 };
  walletList.forEach((wallet, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, walletList.length) - Math.PI / 2;
    wallet.x = walletCenter.x + Math.cos(angle) * walletRadiusX;
    wallet.y = walletCenter.y + Math.sin(angle) * walletRadiusY;
  });
  const byId = new Map(walletList.map((wallet) => [wallet.id, wallet]));
  const txPoints = rows.map((row, index) => {
    const laneCount = 4;
    const colCount = Math.ceil(rows.length / laneCount);
    const col = index % colCount;
    const lane = Math.floor(index / colCount);
    const left = 185;
    const right = width - 56;
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

    txPoints.forEach((tx) => {
      const from = byId.get(tx.from);
      const to = byId.get(tx.to);
      const alpha = 0.06 + Math.max(0, 1 - tx.index / 100) * 0.12;

      [from, to].filter(Boolean).forEach((wallet) => {
        ctx.beginPath();
        ctx.moveTo(tx.x, tx.y);
        const controlX = (tx.x + wallet.x) / 2;
        const controlY = (tx.y + wallet.y) / 2 - 18;
        ctx.quadraticCurveTo(controlX, controlY, wallet.x, wallet.y);
        ctx.strokeStyle = `rgba(255, 25, 146, ${alpha})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      });
    });

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
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 25, 146, ${0.35 + freshness * 0.45})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 25, 146, ${0.18 + freshness * 0.22})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    walletList.forEach((wallet) => {
      const size = 4 + Math.min(8, wallet.weight * 1.2);
      ctx.beginPath();
      ctx.arc(wallet.x, wallet.y, size + pulse * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 25, 146, 0.18)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(wallet.x, wallet.y, size, 0, Math.PI * 2);
      ctx.fillStyle = "#ff1992";
      ctx.fill();

      if (wallet.weight > 1) {
        ctx.fillStyle = "rgba(244, 244, 245, 0.74)";
        ctx.font = "11px SFMono-Regular, Consolas, monospace";
        ctx.fillText(walletLabel(wallet.id), wallet.x + 10, wallet.y + 4);
      }
    });

    ctx.beginPath();
    ctx.arc(center.x, center.y, 34 + pulse * 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 25, 146, 0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 28, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f4f5";
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.font = "800 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$LIVES", center.x, center.y);
    ctx.fillStyle = "rgba(244, 244, 245, 0.62)";
    ctx.font = "11px SFMono-Regular, Consolas, monospace";
    ctx.fillText("newest -> oldest", center.x, center.y + 48);
    ctx.textAlign = "right";
    ctx.fillText("click any pink dot", width - 22, height - 18);
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
  elements.refresh.disabled = true;
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
  } finally {
    elements.refresh.disabled = false;
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
  const content = error
    ? `<div class="feed-state error-text">${escapeHtml(error)}</div>`
    : sortedArticles.length
      ? `${lead ? `
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
      : '<div class="feed-state">No articles found.</div>';

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
  const gdeltMatch = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  return gdeltMatch
    ? `${gdeltMatch[1]}-${gdeltMatch[2]}-${gdeltMatch[3]}T${gdeltMatch[4] || "00"}:${gdeltMatch[5] || "00"}:${gdeltMatch[6] || "00"}Z`
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

  const gdeltCards = newsResult.status === "fulfilled"
    ? renderNewsCache(newsResult.value)
    : NEWS_FEED_NAMES
      .map((name) => renderFeed({ name }, [], newsResult.reason?.message || "Could not load cached news."))
      .join("");

  elements.infinita.innerHTML = substackResult.status === "fulfilled"
    ? renderSubstackFeed(substackResult.value)
    : renderSubstackFeed(null, substackResult.reason?.message || "Could not load Infinita City Times.");

  elements.news.innerHTML = gdeltCards;
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
      return renderFeed(feed, feed.articles || [], feed.error || "");
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
  const rest = items.slice(1, 5);
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

elements.refresh.addEventListener("click", () => {
  page = 1;
  loadAll();
});
elements.limit.addEventListener("change", () => {
  page = 1;
  renderRows();
});
elements.prev.addEventListener("click", () => {
  page = Math.max(1, page - 1);
  renderRows();
});
elements.next.addEventListener("click", () => {
  page += 1;
  renderRows();
});

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
