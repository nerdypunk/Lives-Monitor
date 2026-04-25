import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN_MINT = "27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8";
const SOLSCAN_API = "https://pro-api.solscan.io/v2.0";
const SOLANA_RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL,
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);
const OUTFILE = "data/transactions.json";
const TARGET_TRANSACTION_COUNT = 20;
const DAY_SECONDS = 24 * 60 * 60;

let rpcId = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function loadFromSolscan() {
  console.log("Trying Solscan API...");
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
    source: "Solscan API",
    token: {
      address: TOKEN_MINT,
      name: data.name || "Token",
      symbol: data.symbol || "Token",
      supply: data.supply || data.total_supply || null,
    },
    transactions: normalizeSolscanRows(transfers.data || []),
  };
}

async function loadFromRpc(error) {
  console.log("Trying Solana RPC fallback...");
  const supply = await rpc("getTokenSupply", [TOKEN_MINT, { commitment: "confirmed" }]);
  const signatures = await rpc("getSignaturesForAddress", [
    TOKEN_MINT,
    { limit: TARGET_TRANSACTION_COUNT, commitment: "confirmed" },
  ]);

  const transactions = [];
  for (const item of signatures) {
    try {
      const tx = await rpc("getTransaction", [
        item.signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      const row = tx ? summarizeRpcTransaction(tx, item.signature) : null;
      transactions.push(row || {
        signature: item.signature,
        type: item.err ? "Failed transaction" : "Transaction",
        amountText: "--",
        from: "",
        to: "",
        blockTime: item.blockTime,
        slot: item.slot,
      });
    } catch (transactionError) {
      console.warn(`Skipping ${item.signature}: ${transactionError.message}`);
      transactions.push({
        signature: item.signature,
        type: item.err ? "Failed transaction" : "Transaction",
        amountText: "--",
        from: "",
        to: "",
        blockTime: item.blockTime,
        slot: item.slot,
      });
    }
    await sleep(350);
  }

  return {
    source: `Solana RPC fallback: ${error.message}`,
    token: {
      address: TOKEN_MINT,
      name: "LIVES",
      symbol: "$LIVES",
      supply: supply?.value?.uiAmountString || null,
    },
    transactions,
  };
}

async function loadExistingData(error) {
  console.warn(`Keeping existing data because live update failed: ${error.message}`);
  const existing = JSON.parse(await readFile(OUTFILE, "utf8"));
  existing.source = `${existing.source || "Existing cached data"} (live update failed: ${error.message})`;
  return existing;
}

function countRecentRows(rows) {
  const cutoff = Math.floor(Date.now() / 1000) - DAY_SECONDS;
  return rows.filter((row) => Number(row.blockTime || 0) >= cutoff).length;
}

async function countTransactionsLastDay(rows) {
  const cutoff = Math.floor(Date.now() / 1000) - DAY_SECONDS;
  let before;
  let count = 0;

  try {
    for (let page = 0; page < 5; page += 1) {
      const options = { limit: 1000, commitment: "confirmed" };
      if (before) options.before = before;

      const signatures = await rpc("getSignaturesForAddress", [TOKEN_MINT, options]);
      if (!signatures.length) break;

      for (const item of signatures) {
        if (item.blockTime && item.blockTime >= cutoff) {
          count += 1;
        }
      }

      const oldest = signatures[signatures.length - 1];
      if (!oldest?.blockTime || oldest.blockTime < cutoff) break;
      before = oldest.signature;
      await sleep(450);
    }
    return count;
  } catch (error) {
    console.warn(`Could not compute full 24h count, using cached rows: ${error.message}`);
    return countRecentRows(rows);
  }
}

async function main() {
  console.log(`Updating transactions for ${TOKEN_MINT}`);
  console.log(`Solscan key present: ${process.env.SOLSCAN_API_KEY ? "yes" : "no"}`);

  let payload;
  try {
    payload = await loadFromSolscan();
  } catch (error) {
    console.warn(`Solscan unavailable: ${error.message}`);
    try {
      payload = await loadFromRpc(error);
    } catch (rpcError) {
      payload = await loadExistingData(rpcError);
    }
  }

  payload.updatedAt = new Date().toISOString();
  payload.stats = {
    ...(payload.stats || {}),
    last24h: await countTransactionsLastDay(payload.transactions || []),
  };
  await mkdir("data", { recursive: true });
  await writeFile(OUTFILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUTFILE} with ${payload.transactions.length} transactions from ${payload.source}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
