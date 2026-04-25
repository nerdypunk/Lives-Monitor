const TOKEN_MINT = "27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8";
const DATA_URL = "data/transactions.json";
const SUBSTACK_DATA_URL = "data/infinita-city-times.json";
const GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const SOLSCAN_TX = "https://solscan.io/tx/";
const SOLSCAN_TOKEN = "https://solscan.io/token/";
const NEWS_FEEDS = [
  { name: "DeSci", query: '(DeSci OR "decentralized science") sourcelang:english' },
  { name: "Longevity", query: '(longevity OR "life extension" OR "anti-aging") sourcelang:english' },
  { name: "Biotech", query: '(biotech OR "synthetic biology" OR CRISPR) sourcelang:english' },
  { name: "Crypto", query: '(crypto OR cryptocurrency OR blockchain OR Solana) sourcelang:english' },
];
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
  news: document.querySelector("#newsFeeds"),
  newsUpdated: document.querySelector("#newsUpdatedValue"),
};

let page = 1;
let allRows = [];

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
  elements.news.innerHTML = NEWS_FEEDS
    .map((feed) => `
      <section class="feed-card">
        <h3>${escapeHtml(feed.name)}</h3>
        <div class="feed-state">Loading...</div>
      </section>
    `)
    .join("");
}

function gdeltUrl(query) {
  const url = new URL(GDELT_DOC_API);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", "10");
  url.searchParams.set("sort", "datedesc");
  return url.toString();
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
    throw new Error(cleanText(text).slice(0, 140) || "GDELT returned invalid JSON");
  }

  return (payload.articles || []).filter((article) => {
    const language = cleanText(article.language).toLowerCase();
    return !language || language === "english";
  });
}

async function loadNewsFeeds() {
  renderNewsLoading();
  const [gdeltResults, substackResult] = await Promise.all([
    Promise.allSettled(NEWS_FEEDS.map(fetchFeed)),
    fetchSubstackFeed().then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason })
    ),
  ]);

  const gdeltCards = gdeltResults
    .map((result, index) => {
      const feed = NEWS_FEEDS[index];
      if (result.status === "fulfilled") {
        return renderFeed(feed, result.value.slice(0, 10));
      }
      return renderFeed(feed, [], result.reason?.message || "Could not load feed.");
    })
    .join("");

  const substackCard = substackResult.status === "fulfilled"
    ? renderSubstackFeed(substackResult.value)
    : renderSubstackFeed(null, substackResult.reason?.message || "Could not load Infinita City Times.");

  elements.news.innerHTML = `${substackCard}${gdeltCards}`;
  elements.newsUpdated.textContent = new Intl.DateTimeFormat(undefined, {
    timeStyle: "medium",
  }).format(new Date());
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
    <section class="feed-card substack-card">
      <h3>Infinita City Times Latest</h3>
      ${payload?.error ? `<div class="feed-note">Using bundled fallback until the static feed cache is available.</div>` : ""}
      ${content}
    </section>
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

loadAll();
