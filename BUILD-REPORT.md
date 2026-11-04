# BUILD REPORT — freightlane

Rebuild of `com.eurocollis/eurocollis` (remote-only, keyless capture)
as `@reneturcios/freightlane` 0.1.0 / `io.github.CloudCorpRecords/freightlane`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all 12 tool
names and every required field:

- `get_eurocollis_info` []; `get_services` []; `get_prohibited_items` [];
  `get_routes` []; `get_cities` [country];
  `get_quote` [origin_country, origin_city, destination_country,
  destination_city]; `search_couriers` []; `get_courier` [courier];
  `get_storefront` []; `track_shipment` [reference, delivery_city];
  `estimate_customs` [destination_country, declared_value_eur];
  `convert_currency` [amount, from_currency, to_currency].

Notes on reading the fixture (not conflicts): `get_routes`,
`search_couriers` and `get_storefront` carry optional properties but no
`required` key in the fixture, which matches the brief's "[none]" for
each. The fixture's tool objects carry only name / description /
inputSchema (no `title`, no annotations); they are served verbatim from
`src/forward.ts` — the literals were embedded programmatically from the
fixture JSON so no character was re-typed — and parity compares
inputSchema. The surface is read-only logistics data: no booking/order
tool exists in the fixture and none was added.

## What was built

All 19 factory files under `builds/freightlane/`:

- `package.json` (`@reneturcios/freightlane` 0.1.0, bin
  `freightlane` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 87-char string;
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/freightlane:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label matches
  `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-27)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/freightlane`, smoke assertion on server name
  `freightlane`)

## Design

- Forwarding client to `https://api.eurocollis.com/mcp` (pinned),
  overridable via `EUROCOLLIS_MCP_URL` (labelled reconstruction).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo name
  `freightlane`) → notifications/initialized → tools/call, honouring
  `Mcp-Session-Id` when issued; session established lazily and reused
  per client. Plain-JSON and SSE replies both parsed; the
  matching-id message wins; upstream results pass through verbatim
  (including `isError` and extra fields such as `structuredContent`).
- Auth forwarding (labelled reconstruction; the capture was keyless):
  the registry record pins the header name `x-eurocollis-key`, so when
  env `EUROCOLLIS_API_KEY` is set its value is sent as that header on
  every upstream request (initialize, notification and tools/call);
  when unset, no auth header is sent.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `freightlane error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  unknown tools throw McpError MethodNotFound and non-object arguments
  McpError InvalidParams before any network hop; the CLI's `mcp`
  subcommand starts the server over stdio.
- Core takes injectable deps (`fetchFn` / `env` / `url` / `timeoutMs`,
  default 30000 ms), so all tests run against a stubbed JSON-RPC
  upstream. No live network calls in tests; no live call claimed
  anywhere.

## Lockfile (Route 3, clean from birth)

Generated in a temp dir containing only the new `package.json`:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/freightlane`, **128 package
entries**. Copied into the build dir with matching sha256
(`63cc2755aeef028c…` on both sides — a plain verified copy, not the
write-guard staging fallback; no write-guard failure occurred). Then
`npm install --offline --ignore-scripts` in the build dir for
`node_modules`.

## Verification (all in the build dir)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2353 B, forward.js 17318 B,
  mcp.js 2687 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **33 tests, 33 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 12 tool
  objects, names in order, required fields per tool; session
  establishment/reuse/session-id handling; env + url overrides;
  `x-eurocollis-key` header present on every request when
  `EUROCOLLIS_API_KEY` is set and absent when unset; verbatim argument
  forwarding; verbatim result pass-through incl. upstream isError and
  SSE; JSON-RPC/init/malformed/HTTP/throw/timeout failures →
  `freightlane error:`; parseRpcBody; MCP-layer validation; CLI
  --version / unknown exit 2 / bad-JSON exit 2)
- Parity: `python3 ../../harness/parity.py --original
  ../../harness/fixtures/eurocollis-tools-original.json --rebuild
  "stdio:node dist/cli.js mcp" --out parity-out` → **PASS, parity 100.0,
  12/12 identical, no missing/extra/schema diffs** (see
  `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at exactly 87 chars; OCI
  entry confirmed to have no `version` field.

Clean-room: all prose and code written fresh; only the fixture's tool
literals are served verbatim. Not published, not pushed;
NAMES/SCOREBOARD/WALK untouched.
