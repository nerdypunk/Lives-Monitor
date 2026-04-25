import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN_MINT = "27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8";
const SOLSCAN_API = "https://pro-api.solscan.io/v2.0";
const SOLANA_RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);
const OUTFILE = "data/transactions.json";
const FULL_HISTORY = process.env.FULL_HISTORY === "true";
const DAY_SECONDS = 24 * 60 * 60;
const LATEST_SIGNATURE_LIMIT = 120;
const SIGNATURE_PAGE_LIMIT = 1000;
const MAX_SIGNATURE_PAGES = Number(process.env.MAX_SIGNATURE_PAGES || 100);
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT || (FULL_HISTORY ? 80 : 35));

let rpcId = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyPayload(source = "Empty cache") {
  return {
    source,
    token: {
      address: TOKEN_MINT,
      name: "LIVES",
      symbol: "$LIVES",
      supply: null,
    },
    transactions: [],
    stats: { last24h: 0, totalCached: 0, historyComplete: false },
    updatedAt: null,
  };
}

async function readExistingData() {
  try {
    return JSON.parse(await readFile(OUTFILE, "utf8"));
  } catch {
    return emptyPayload("New cache");
  }
}

function formatRawAmount(rawAmount, decimals) {
  const raw = String(rawAmount ?? "0");
  if (!/^\d+$/.test(raw)) {
    return String(Number(raw) / 10 ** Number(decimals || 0));
  }

  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals || 0);
  const whole = value / scale;
  const fraction = value % scale;
  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (!fraction || !decimals) return wholeFormatted;

  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 8);
  return `${wholeFormatted}.${fractionText}`;
}

async function solscan(path, params = {}) {
  const apiKey = process.env.SOLSCAN_API_KEY;
  if (!apiKey) throw new Error("SOLSCAN_API_KEY is not set, using RPC fallback");

  const url = new URL(`${SOLSCAN_API}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      token: apiKey,
    },
  });

  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.success !== false) return payload;

  const message = payload?.errors?.message || payload?.message || payload?.error;
  throw new Error(message || `Solscan API request failed with HTTP ${response.status}`);
}

async function rpc(method, params = []) {
  let lastError;

  for (const endpoint of SOLANA_RPC_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      console.log(`Calling Solana RPC: ${method} via ${endpoint} (attempt ${attempt})`);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: rpcId++,
          method,
          params,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (response.ok && !payload?.error) {
        return payload.result;
      }

      lastError = new Error(payload?.error?.message || `Solana RPC request failed with HTTP ${response.status}`);
      const rateLimited = response.status === 429 || /too many|rate/i.test(lastError.message);
      if (!rateLimited) break;
      await sleep(1200 * attempt);
    }
  }

  throw lastError || new Error("All Solana RPC endpoints failed");
}

function normalizeSolscanRows(rows) {
  return rows.map((row) => ({
    signature: row.trans_id || row.tx_hash || row.signature || "",
    type: (row.activity_type || "transfer").replace("ACTIVITY_SPL_", "").replaceAll("_", " "),
    amountText: formatRawAmount(row.amount, row.token_decimals),
    from: row.from_address || "",
    to: row.to_address || "",
    blockTime: row.block_time,
    slot: row.block_id,
  }));
}

function signatureRow(item) {
  return {
    signature: item.signature,
    type: item.err ? "Failed transaction" : "Transaction",
    amountText: "--",
    from: "",
    to: "",
    blockTime: item.blockTime,
    slot: item.slot,
  };
}

function mergeTransactions(existingRows, incomingRows) {
  const bySignature = new Map();

  for (const row of existingRows || []) {
    if (row.signature) bySignature.set(row.signature, row);
  }

  for (const row of incomingRows || []) {
    if (!row.signature) continue;
    const existing = bySignature.get(row.signature);
    const incomingHasDetails = row.amountText && row.amountText !== "--";
    const existingHasDetails = existing?.amountText && existing.amountText !== "--";
    if (!existing || incomingHasDetails || !existingHasDetails) {
      bySignature.set(row.signature, { ...existing, ...row });
    }
  }

  return [...bySignature.values()].sort((a, b) => Number(b.blockTime || 0) - Number(a.blockTime || 0));
}

function rawTokenAmount(balance) {
  const amount = balance?.uiTokenAmount?.amount;
  return amount ? BigInt(amount) : 0n;
}

function balanceKey(balance) {
  return `${balance.accountIndex}:${balance.owner || ""}`;
}

function summarizeRpcTransaction(tx, fallbackSignature) {
  const pre = new Map(
    (tx.meta?.preTokenBalances || [])
      .filter((balance) => balance.mint === TOKEN_MINT)
      .map((balance) => [balanceKey(balance), balance])
  );
  const post = new Map(
    (tx.meta?.postTokenBalances || [])
      .filter((balance) => balance.mint === TOKEN_MINT)
      .map((balance) => [balanceKey(balance), balance])
  );
  const keys = new Set([...pre.keys(), ...post.keys()]);
  const deltas = [...keys]
    .map((key) => {
      const before = rawTokenAmount(pre.get(key));
      const after = rawTokenAmount(post.get(key));
      const balance = post.get(key) || pre.get(key);
      return {
        owner: balance?.owner || "",
        delta: after - before,
        decimals: balance?.uiTokenAmount?.decimals || 0,
      };
    })
    .filter((item) => item.delta !== 0n);

  const outgoing = deltas.filter((item) => item.delta < 0n).sort((a, b) => Number(a.delta - b.delta));
  const incoming = deltas.filter((item) => item.delta > 0n).sort((a, b) => Number(b.delta - a.delta));
  const largestOut = outgoing[0];
  const largestIn = incoming[0];
  const amount = largestIn?.delta || -(largestOut?.delta || 0n);
  const decimals = largestIn?.decimals ?? largestOut?.decimals ?? 0;

  if (amount <= 0n) return null;

  let type = "Token change";
  if (largestOut && largestIn) type = "Transfer";
  if (!largestOut && largestIn) type = "Mint / Receive";
  if (largestOut && !largestIn) type = "Burn / Send";

  return {
    signature: tx.transaction?.signatures?.[0] || fallbackSignature,
    type,
    amountText: formatRawAmount(amount.toString(), decimals),
    from: largestOut?.owner || "",
    to: largestIn?.owner || "",
    blockTime: tx.blockTime,
    slot: tx.slot,
  };
}

async function fetchSignatureRows() {
  const rows = [];
  let before;

  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const options = {
      limit: FULL_HISTORY ? SIGNATURE_PAGE_LIMIT : LATEST_SIGNATURE_LIMIT,
      commitment: "confirmed",
    };
    if (before) options.before = before;

    const signatures = await rpc("getSignaturesForAddress", [TOKEN_MINT, options]);
    rows.push(...signatures.map(signatureRow));
    console.log(`Fetched ${rows.length} signature rows${FULL_HISTORY ? " during full backfill" : ""}`);

    if (!FULL_HISTORY || signatures.length < options.limit) break;
    before = signatures[signatures.length - 1].signature;
    await sleep(600);
  }

  return rows;
}

async function enrichRows(rows) {
  let enriched = 0;
  const output = [];

  for (const row of rows) {
    if (enriched >= ENRICH_LIMIT || (row.amountText && row.amountText !== "--")) {
      output.push(row);
      continue;
    }

    try {
      const tx = await rpc("getTransaction", [
        row.signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      output.push(summarizeRpcTransaction(tx, row.signature) || row);
      enriched += 1;
    } catch (error) {
      console.warn(`Could not enrich ${row.signature}: ${error.message}`);
      output.push(row);
    }
    await sleep(350);
  }

  return output;
}

async function getSupply(existingToken) {
  try {
    const supply = await rpc("getTokenSupply", [TOKEN_MINT, { commitment: "confirmed" }]);
    return supply?.value?.uiAmountString || existingToken?.supply || null;
  } catch (error) {
    console.warn(`Could not update supply: ${error.message}`);
    return existingToken?.supply || null;
  }
}

async function updateFromSolscan(existing) {
  console.log("Trying Solscan API for latest rows...");
  const [meta, transfers] = await Promise.all([
    solscan("/token/meta", { address: TOKEN_MINT }),
    solscan("/token/transfer", {
      address: TOKEN_MINT,
      page: 1,
      page_size: 100,
      sort_by: "block_time",
      sort_order: "desc",
      exclude_amount_zero: true,
    }),
  ]);

  const data = meta.data || {};
  return {
    ...existing,
    source: "Solscan API latest merge",
    token: {
      address: TOKEN_MINT,
      name: data.name || existing.token?.name || "LIVES",
      symbol: data.symbol || existing.token?.symbol || "$LIVES",
      supply: data.supply || data.total_supply || existing.token?.supply || null,
    },
    transactions: mergeTransactions(existing.transactions, normalizeSolscanRows(transfers.data || [])),
  };
}

async function updateFromRpc(existing, reason) {
  console.log(FULL_HISTORY ? "Running full RPC history backfill..." : "Running latest RPC merge...");
  const signatureRows = await fetchSignatureRows();
  const merged = mergeTransactions(existing.transactions, signatureRows);
  const enriched = await enrichRows(merged);

  return {
    ...existing,
    source: FULL_HISTORY ? `Full RPC history backfill: ${reason.message}` : `Solana RPC latest merge: ${reason.message}`,
    token: {
      address: TOKEN_MINT,
      name: existing.token?.name || "LIVES",
      symbol: existing.token?.symbol || "$LIVES",
      supply: await getSupply(existing.token),
    },
    transactions: mergeTransactions(merged, enriched),
  };
}

function countRecentRows(rows) {
  const cutoff = Math.floor(Date.now() / 1000) - DAY_SECONDS;
  return rows.filter((row) => Number(row.blockTime || 0) >= cutoff).length;
}

function finalizePayload(payload) {
  const transactions = mergeTransactions([], payload.transactions || []);
  return {
    ...payload,
    token: {
      address: TOKEN_MINT,
      name: payload.token?.name || "LIVES",
      symbol: payload.token?.symbol || "$LIVES",
      supply: payload.token?.supply || null,
    },
    transactions,
    stats: {
      ...(payload.stats || {}),
      last24h: countRecentRows(transactions),
      totalCached: transactions.length,
      historyComplete: FULL_HISTORY || Boolean(payload.stats?.historyComplete),
    },
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log(`Updating transactions for ${TOKEN_MINT}`);
  console.log(`Solscan key present: ${process.env.SOLSCAN_API_KEY ? "yes" : "no"}`);
  console.log(`Full history mode: ${FULL_HISTORY ? "yes" : "no"}`);

  const existing = await readExistingData();
  let payload;

  try {
    if (FULL_HISTORY) throw new Error("Full history requested");
    payload = await updateFromSolscan(existing);
  } catch (error) {
    console.warn(`Solscan unavailable or skipped: ${error.message}`);
    try {
      payload = await updateFromRpc(existing, error);
    } catch (rpcError) {
      console.warn(`Keeping existing data because live update failed: ${rpcError.message}`);
      payload = existing.transactions?.length ? existing : emptyPayload(`Live update failed: ${rpcError.message}`);
    }
  }

  payload = finalizePayload(payload);
  await mkdir("data", { recursive: true });
  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTFILE} with ${payload.transactions.length} cached transactions`);
  console.log(`Last 24h transactions: ${payload.stats.last24h}`);
  console.log(`History complete: ${payload.stats.historyComplete}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
