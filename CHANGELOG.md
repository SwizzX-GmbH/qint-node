# Changelog

All notable changes to `@qint/node`. Versions follow semver; `0.x` minors may
contain small breaking changes, called out below.

## 0.2.0 — 2026-10-14

Brings the SDK in sync with the Qint merchant API as of 2026-10-14.

### Added
- `QintClient.listCurrencies()` — `GET /api/v1/public/currencies`: every fiat
  currency with its `enabled` flag (public, no API key sent, cacheable 30 s).
  `QintClient.enabledCurrencies()` returns just the enabled codes. Use it to
  hide currencies Qint has switched off.
- `SettlementAsset` (`"USDT" | "USDC"`) and `SETTLEMENT_ASSETS`.
- `Intent.creditAsset` — the stablecoin the credit was booked in (USDC for
  EU-registered merchants, USDT otherwise); `Intent.reversed` and
  `Intent.underpaid` flags.
- Webhooks: `PingEvent`, `UnknownEvent`, the `QintEvent` union and the
  `isPaymentStatusEvent` / `isPingEvent` type guards.
- `ERROR_CODES`, including `settlement_asset_mismatch` (dashboard payout
  endpoints); `QintApiError.traceId` and `ProblemDetails.traceId`.

### Changed
- `Intent.feeAmount` / `Intent.netAmount` are typed `number | null` (the API
  sends `null` until the payment settles).
- `creditUsdt` / `creditRate` are documented as amounts in `creditAsset`.
- **Breaking (types only):** `parseEvent()` now returns `QintEvent` instead of
  `PaymentStatusEvent`, because `ping` and future event types arrive on the same
  endpoint. Narrow with `isPaymentStatusEvent(event)`, or pass the type
  explicitly: `parseEvent<PaymentStatusEvent>(raw)`. Assigning the result to a
  `PaymentStatusEvent`-typed variable still compiles.
- README: currency availability, the disabled-currency `400` (no `code`),
  per-payment limits, the settlement asset.

## 0.1.0

- Initial release: `createIntent`, `getIntent`, `listIntents`, webhook
  signature verification and `parseEvent`; GBP, accepted-underpayment and
  reversal fields, typed problem `code`.
