# Lives Monitor

A GitHub Pages compatible static site for monitoring recent Solscan-indexed transfers for:

`27TyCz2Y4rFPfURPCPxByEW6AeMfQSNCMFcPmK4fvEA8`

The page is GitHub Pages compatible. Visitors only load static files plus `data/transactions.json`; GitHub Actions refreshes that JSON on a schedule.

The dashboard shows the latest cached transactions plus a 24-hour transaction count computed by the updater.

## Local use

Publish the repository with GitHub Pages. For local testing, serve the folder with a small static server so the browser can fetch `data/transactions.json`.

Add the Solscan key as a repository secret named `SOLSCAN_API_KEY`, then run the `Update token transactions` workflow once. The workflow also runs every 15 minutes.

This avoids browser CORS failures and keeps visitors from needing to enter a key.

To save all historical token transactions, run the workflow manually and set `full_history` to `true`. Scheduled runs keep the saved archive updated by merging the newest transactions.

The same workflow also refreshes `data/infinita-city-times.json` from the Infinita City Times Substack RSS feed.

GDELT news is cached in `data/news.json` by the workflow so visitors do not wait on live GDELT API requests.

The data updater tries Solscan first:

- `GET https://pro-api.solscan.io/v2.0/token/meta`
- `GET https://pro-api.solscan.io/v2.0/token/transfer`

If Solscan rejects the key, the updater falls back to Solana JSON-RPC:

- `getTokenSupply`
- `getSignaturesForAddress`
- `getTransaction` with `jsonParsed`
