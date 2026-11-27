# Step 01 notes: Hello World MCP server

**Live MCP URL:** https://learn-mcp-step-01.stockroom-mms.workers.dev/mcp

A minimal remote MCP server on Cloudflare Workers with no auth, serving two tools over Streamable HTTP at `/mcp`.

## What I built and why

* We build a remote mcp server on cloudflare with two tools which are reachable from claude and chatgpt
* A server object built for one request and then discarded can't carry anything over to the next request: not a variable, a cache, the last caller's company, or a half-finished call. You don't have to remember to be careful; the design makes leaks impossible.
* Chatgpt responding from its own clock rather than using a tool call then adding its fix as well

### The ChatGPT clock fix

When asked "What time is it in Karachi right now?", ChatGPT answered with its own built-in clock widget instead of calling `get_time`. I rewrote the `get_time` title and description to say exactly which questions it answers and what it returns, and how a city maps to an IANA zone (Karachi is `Asia/Karachi`).

The description does **not** say "always use this tool instead of your own". Anthropic's connector review treats behaviour instructions in a tool description as prompt injection. So the host can still prefer its own tool for a plain time question. Naming the connector in the prompt (`@Stockroom Step 01 what time is it in Karachi?`) makes it use ours, as `chatgpt-2.png` shows.

## How it works

- **`src/index.ts`**: creates the MCP handler once, at module level, with `createMcpHandler(createServer, { route: "/mcp" })` from `agents/mcp/server`. Any path other than `/mcp` returns 404.
- **`src/server.ts`**: the factory the handler calls on **every request**. It builds a fresh `McpServer` (MCP SDK v2, `@modelcontextprotocol/server`) and registers the tools. Nothing about a request is kept in module scope, so any copy of the Worker can answer any request.
- **`src/tools.ts`**: the two tools, both read-only.
  - `greet` takes a required `name` (1 to 100 characters) and returns a greeting.
  - `get_time` takes an optional IANA `timezone` (defaults to UTC) and returns the current time. An unknown zone returns a recoverable error instead of throwing.

The server follows the MCP 2026-07-28 spec: there's no `initialize` handshake and no session, and each request carries the protocol version and the client's capabilities.

## Run locally

From this folder, using Node.js 24 or later:

```bash
npm install
npm run dev
```

The server runs at `http://localhost:8787/mcp`. To inspect it, run the MCP Inspector (`npx @modelcontextprotocol/inspector`), choose the **Streamable HTTP** transport, and connect to that URL.

## Test

```bash
npm run typecheck   # wrangler types && tsc (type-check only)
npm test            # Vitest in the Workers runtime
```

`test/stateless.test.ts` sends 20 concurrent `tools/call` requests to `greet`, each with a different name. It checks that every response carries its own name and id, which proves no state leaks between requests.

The test runner's bundled workerd only supports compatibility dates up to 2026-08-22, so `vitest.config.ts` pins that date for tests. The deployed Worker uses the date in `wrangler.jsonc`.

## Deploy

```bash
npx wrangler login   # once, in the browser
npm run deploy       # wrangler deploy, Worker name learn-mcp-step-01
```

Clients use the printed URL with `/mcp` added. The server has no auth yet, so the URL is public until Step 04.

## Connect

- **claude.ai or Claude Desktop:** go to Settings, then Connectors, then **Add custom connector**. Paste the live URL and leave the OAuth fields empty.
- **ChatGPT:** go to Settings, then Plugins, and add a custom MCP server with the live URL and **No authentication**.

Test prompt: *"Use the Stockroom Step 01 connector to greet Ayesha."*

## Pinned versions

| Package | Version |
| --- | --- |
| agents | 0.31.0 |
| @modelcontextprotocol/server | 2.3.1 |
| zod | 4.6.7 |
| wrangler | 4.168.0 |
| typescript | 7.0.2 |
| vitest / @cloudflare/vitest-pool-workers | 4.1.12 / 0.23.0 |
