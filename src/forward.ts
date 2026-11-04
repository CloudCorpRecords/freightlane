/**
 * freightlane core: a forwarding client for the remote
 * EuroCollis MCP server (Morocco-Europe shipping data).
 *
 * This module holds no logistics data of its own.
 * tools/list is served from the literal tool
 * definitions below, taken verbatim from a live capture
 * of the upstream server (name, description and
 * inputSchema exactly as captured; the capture's
 * annotations are not reproduced). A tools/call is
 * forwarded over a streamable-HTTP JSON-RPC session:
 * an initialize POST, a notifications/initialized POST,
 * then the tools/call POST, honouring the
 * Mcp-Session-Id response header when the upstream
 * issues one. The session is established lazily on the
 * first forwarded call and reused for the lifetime of
 * the client. The surface is read-only: there is no
 * booking or ordering tool to forward.
 *
 * The upstream endpoint is pinned to
 * https://api.eurocollis.com/mcp and can be overridden
 * with the EUROCOLLIS_MCP_URL environment variable
 * (that override is a labelled reconstruction). The
 * registry record pins the auth header name
 * `x-eurocollis-key`: when the EUROCOLLIS_API_KEY
 * environment variable is set, its value is sent under
 * that header on every upstream request (a labelled
 * reconstruction — the tools/list capture itself was
 * taken keyless); when it is unset, no auth header is
 * sent.
 *
 * Upstream results pass through verbatim, including
 * any isError flag and any extra result fields.
 * Failures — a JSON-RPC error from the upstream, a
 * non-2xx status, an unparseable response, or a fetch
 * that throws or times out — surface as an isError
 * result whose text starts with `freightlane error:`
 * (that rendering is a labelled reconstruction).
 * Responses may be plain JSON or SSE (data: lines);
 * the JSON-RPC message with the matching id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://api.eurocollis.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/eurocollis-tools-original.json)         */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "get_eurocollis_info",
    "description": "What EuroCollis is, the corridors it operates, currency, deposit model and where bookings are completed.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "get_services",
    "description": "Shippable item catalogue with pricing units — use item_id values when calling get_quote with items.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "get_prohibited_items",
    "description": "Items EuroCollis and Morocco/EU customs prohibit. Always surface before a booking recommendation.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "get_routes",
    "description": "Every supported Europe ↔ Africa corridor. Optionally scope to one corridor for live trip volume.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "origin_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "destination_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "get_cities",
    "description": "Supported pickup/delivery cities for one country. Use these exact names as origin_city / destination_city in get_quote.",
    "inputSchema": {
      "type": "object",
      "required": [
        "country"
      ],
      "properties": {
        "country": {
          "type": "string",
          "description": "ISO-3166 alpha-2, e.g. MA or FR"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "get_quote",
    "description": "Authoritative price quote for a Europe ↔ Africa shipment, returned from the same pricing engine the website uses. Provide weight_kg for boxes/suitcases or items[] for catalogue goods. Never re-compute prices yourself.",
    "inputSchema": {
      "type": "object",
      "required": [
        "origin_country",
        "origin_city",
        "destination_country",
        "destination_city"
      ],
      "properties": {
        "origin_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "origin_city": {
          "type": "string",
          "description": "Pickup city name, exactly as returned by get_cities."
        },
        "destination_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "destination_city": {
          "type": "string",
          "description": "Delivery city name, exactly as returned by get_cities."
        },
        "weight_kg": {
          "type": "number",
          "description": "Total weight for box/suitcase shipments"
        },
        "items": {
          "type": "array",
          "description": "Catalogue goods. Use item_id (or name) from get_services.",
          "items": {
            "type": "object",
            "required": [
              "quantity"
            ],
            "properties": {
              "item_id": {
                "type": "string",
                "description": "Catalogue item identifier from get_services."
              },
              "name": {
                "type": "string",
                "description": "Catalogue item name from get_services (alternative to item_id)."
              },
              "quantity": {
                "type": "number",
                "description": "Quantity of this item to ship."
              }
            }
          }
        },
        "pickup_date": {
          "type": "string",
          "description": "YYYY-MM-DD, defaults to today"
        },
        "flex_days": {
          "type": "number",
          "description": "Search window after pickup_date (default 14)"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "search_couriers",
    "description": "Live, verified couriers with upcoming trips on a corridor. Demo accounts, unverified couriers and past departures are excluded.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "origin_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "destination_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "from_date": {
          "type": "string",
          "description": "YYYY-MM-DD, defaults to today"
        },
        "limit": {
          "type": "number",
          "description": "Maximum number of couriers to return."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "get_courier",
    "description": "Public profile for one courier by storefront slug or courier id. No PII.",
    "inputSchema": {
      "type": "object",
      "required": [
        "courier"
      ],
      "properties": {
        "courier": {
          "type": "string",
          "description": "Storefront slug or courier UUID"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "get_storefront",
    "description": "Published courier storefront with its canonical URL (custom domain / subdomain / platform path) and corridor pages. Omit slug to list storefronts.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "slug": {
          "type": "string",
          "description": "Courier storefront slug identifying which storefront to return; omit to list storefronts."
        },
        "limit": {
          "type": "number",
          "description": "Used when listing"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "track_shipment",
    "description": "Public shipment status. Requires BOTH the reference and the delivery city (anti-enumeration). No PII returned.",
    "inputSchema": {
      "type": "object",
      "required": [
        "reference",
        "delivery_city"
      ],
      "properties": {
        "reference": {
          "type": "string",
          "description": "e.g. BK-XXXXXX"
        },
        "delivery_city": {
          "type": "string",
          "description": "Delivery city of the shipment; required together with the reference as an anti-enumeration check."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "estimate_customs",
    "description": "Indicative duty + VAT estimate. NOT authoritative — always render the returned disclaimer verbatim.",
    "inputSchema": {
      "type": "object",
      "required": [
        "destination_country",
        "declared_value_eur"
      ],
      "properties": {
        "destination_country": {
          "type": "string",
          "description": "ISO-3166 alpha-2"
        },
        "declared_value_eur": {
          "type": "number",
          "description": "Declared value of the goods in EUR, used to estimate duty and VAT."
        },
        "category": {
          "type": "string",
          "description": "Goods category used to pick the applicable duty and VAT rates."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "convert_currency",
    "description": "Convert an amount between EuroCollis-supported currencies using live MAD-based rates.",
    "inputSchema": {
      "type": "object",
      "required": [
        "amount",
        "from_currency",
        "to_currency"
      ],
      "properties": {
        "amount": {
          "type": "number",
          "description": "Amount to convert."
        },
        "from_currency": {
          "type": "string",
          "description": "Currency code to convert from."
        },
        "to_currency": {
          "type": "string",
          "description": "Currency code to convert to."
        }
      },
      "additionalProperties": false
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `freightlane error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class FreightlaneClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).EUROCOLLIS_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).EUROCOLLIS_API_KEY;
    if (raw && raw.trim() !== "") return raw;
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) {
      headers["x-eurocollis-key"] = key;
    }
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "freightlane", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): FreightlaneClient {
  return new FreightlaneClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new FreightlaneClient(deps).callTool(name, args);
}
