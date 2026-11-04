# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the remote EuroCollis MCP server, serving all 12 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `get_eurocollis_info`, `get_services`, `get_prohibited_items`, `get_routes`, `get_cities`, `get_quote`, `search_couriers`, `get_courier`, `get_storefront`, `track_shipment`, `estimate_customs`, `convert_currency`. The surface is read-only logistics data; no booking or ordering tool exists upstream and none is added here.
- Upstream results pass through verbatim; upstream failures surface as `freightlane error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `EUROCOLLIS_MCP_URL`; when `EUROCOLLIS_API_KEY` is set it is forwarded as the `x-eurocollis-key` header on every upstream request.
