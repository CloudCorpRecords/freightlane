# freightlane

freightlane is a thin local bridge to EuroCollis, a
shipping service running corridors between Europe and
Africa — Morocco in particular. Its hosted MCP server
publishes the read-only logistics data behind the
service's public pricing and tracking: the shippable
item catalogue, supported routes and cities, price
quotes from the same engine the website uses, live
courier trips and storefronts, shipment tracking, and
indicative customs estimates.

The bridge stores nothing and prices nothing itself.
It serves the upstream server's tool list locally —
exactly as captured from the live endpoint — and
forwards each tool call upstream, returning the result
untouched. There is deliberately no booking tool here:
the upstream surface is read-only, and bookings are
confirmed outside it.

## Tools

- `get_eurocollis_info` — what EuroCollis is: the
  corridors it operates, its currency and deposit
  model, and where bookings are completed. No
  arguments.
- `get_services` — the shippable item catalogue with
  its pricing units. The `item_id` values here are
  what `get_quote` accepts in its `items` list. No
  arguments.
- `get_prohibited_items` — items that EuroCollis and
  Morocco/EU customs prohibit. Worth surfacing before
  any booking recommendation. No arguments.
- `get_routes` — every supported Europe ⇔ Africa
  corridor. Optional: `origin_country` and
  `destination_country` (ISO-3166 alpha-2) to scope
  the answer to one corridor with live trip volume.
- `get_cities` — supported pickup and delivery cities
  for one country (`country`, required, ISO-3166
  alpha-2 such as `MA` or `FR`). Quote calls expect
  these exact names.
- `get_quote` — the authoritative price quote for a
  shipment. Required: `origin_country`,
  `origin_city`, `destination_country`,
  `destination_city`. Provide `weight_kg` for
  box/suitcase shipments or `items` for catalogue
  goods (each with a `quantity`, plus `item_id` or
  `name` from `get_services`); optional `pickup_date`
  (`YYYY-MM-DD`, defaults to today) and `flex_days`
  (search window after pickup, default 14). Prices
  come from the upstream engine — never re-compute
  them locally.
- `search_couriers` — live, verified couriers with
  upcoming trips on a corridor; demo accounts,
  unverified couriers and past departures are
  excluded upstream. Optional: `origin_country`,
  `destination_country`, `from_date` (`YYYY-MM-DD`,
  defaults to today) and `limit`.
- `get_courier` — the public profile for one courier
  (`courier`, required: storefront slug or courier
  id). No personal data is returned.
- `get_storefront` — a published courier storefront
  with its canonical URL and corridor pages. Optional:
  `slug` to pick one storefront, `limit` when listing;
  omit `slug` to list storefronts.
- `track_shipment` — public shipment status. Both
  `reference` (e.g. `BK-XXXXXX`) and `delivery_city`
  are required, as an anti-enumeration measure. No
  personal data is returned.
- `estimate_customs` — an indicative duty and VAT
  estimate. Required: `destination_country` and
  `declared_value_eur`; optional `category`. The
  estimate is not authoritative, and the disclaimer
  it returns should be rendered verbatim.
- `convert_currency` — convert an amount between
  EuroCollis-supported currencies using live
  MAD-based rates. Required: `amount`,
  `from_currency`, `to_currency`.

## Configuration

- `EUROCOLLIS_MCP_URL` (optional) — override the
  upstream endpoint. Defaults to
  `https://api.eurocollis.com/mcp`. (The override hook
  is this rebuild's own labelled reconstruction.)
- `EUROCOLLIS_API_KEY` (optional) — when set, its
  value is sent to the upstream on every request
  under the `x-eurocollis-key` header, the header
  name pinned by the upstream's registry record.
  When unset, no auth header is sent; the captured
  surface was read keyless. (This forwarding is a
  labelled reconstruction.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `freightlane`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `freightlane error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string (omit it for tools that take none):

```bash
npx @reneturcios/freightlane get_cities '{"country":"MA"}'
npx @reneturcios/freightlane get_quote '{"origin_country":"FR","origin_city":"Paris","destination_country":"MA","destination_city":"Casablanca","weight_kg":12.5}'
npx @reneturcios/freightlane get_routes
npx @reneturcios/freightlane --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/freightlane mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "freightlane": {
      "command": "npx",
      "args": ["-y", "@reneturcios/freightlane", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/freightlane
docker run --rm ghcr.io/cloudcorprecords/freightlane --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
