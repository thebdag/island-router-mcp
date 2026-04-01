---
name: skill-mcp-builder
description: "Build MCP (Model Context Protocol) servers in TypeScript or Python. Covers project scaffolding, tool/resource/prompt registration, Zod schema design, meta-tool patterns, transport setup, testing, and mcp_config.json integration. Use when creating a new MCP server, adding tools to an existing server, or debugging MCP tool registration."
category: development
risk: safe
source: community
tags: [mcp, model-context-protocol, typescript, python, tool-registration, zod, server-development]
date_added: "2026-04-01"
---

# MCP Server Builder

Build Model Context Protocol (MCP) servers that expose structured tools, resources, and prompts to AI assistants.

## When to Use

- Creating a new MCP server project from scratch
- Adding tools, resources, or prompts to an existing MCP server
- Designing Zod input schemas for tool parameters
- Implementing meta-tool patterns to reduce token overhead
- Configuring `mcp_config.json` for Antigravity/Claude Code
- Debugging MCP server connectivity or tool registration
- Migrating from SDK v1 (`server.tool()`) to v2 (`server.registerTool()`)

## When NOT to Use

- Building MCP clients (this skill covers server-side only)
- General TypeScript/Python development without MCP
- Working with existing MCP servers as a user (use the server's own tools)

---

## Project Scaffolding (TypeScript)

### Minimal Structure

```
my-mcp-server/
├── src/
│   └── server.ts            # Entrypoint — all tool registration
├── build/                    # Compiled JS output (git-ignored)
├── package.json              # ESM project config
├── tsconfig.json             # TypeScript settings
└── README.md
```

### Extended Structure (with parsers, config, skill)

```
my-mcp-server/
├── src/
│   ├── server.ts             # Entrypoint + tool dispatch
│   ├── client.ts             # Backend client (SSH, HTTP, DB, etc.)
│   └── parsers/              # Raw output → structured JSON
│       └── *.ts
├── .agent/skills/            # AI-readable reference skill
│   └── my-skill/SKILL.md
├── devices.json              # Runtime config (git-ignored)
├── devices.example.json      # Template for users
├── package.json
├── tsconfig.json
└── README.md
```

### package.json Template

```json
{
  "name": "my-mcp-server",
  "version": "0.1.0",
  "type": "module",
  "main": "build/server.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "start": "node build/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

### tsconfig.json Template

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "build",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

---

## Tool Registration

### SDK v1 Pattern (current — `server.tool()`)

Use this when the server SDK version uses `@modelcontextprotocol/sdk`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-mcp-server",
  version: "0.1.0",
});

// Tool with Zod schema — shape is inlined (no z.object wrapper needed)
server.tool(
  "my_tool",                              // tool name (snake_case)
  "Description for the AI assistant",     // shown in tool listing
  {                                       // input schema (raw Zod shape)
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results"),
  },
  async ({ query, limit }) => {
    const results = await doSomething(query, limit);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);
```

### SDK v2 Pattern (migration — `server.registerTool()`)

Use this when the server SDK version uses `@modelcontextprotocol/server`:

```typescript
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const server = new McpServer({ name: "my-mcp-server", version: "0.1.0" });

server.registerTool(
  "my_tool",
  {
    title: "My Tool",
    description: "Description for the AI assistant",
    inputSchema: z.object({               // z.object() wrapper required
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Max results"),
    }),
  },
  async ({ query, limit }) => {
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

---

## Meta-Tool Pattern

Reduce token overhead by consolidating related operations into a single tool with an `action` discriminator. This is the recommended architecture when a server has many similar operations.

### Why Meta-Tools

| Approach | Tools registered | Token cost per invocation |
|---|---|---|
| One tool per operation | 15+ tools | High — all schemas in context |
| Meta-tool with actions | 2-3 tools | Low — single schema, action dispatch |

### Pattern: Read vs Write Split

```typescript
const QueryActions = z.enum([
  "status", "list", "get", "search",
]);

server.tool(
  "my_query",
  "Read-only operations. Actions: status, list, get, search.",
  {
    action: QueryActions.describe("Query action to perform"),
    id: z.string().optional().describe("Item ID (for get)"),
    query: z.string().optional().describe("Search query (for search)"),
  },
  async ({ action, id, query }) => {
    switch (action) {
      case "status": return queryStatus();
      case "list":   return queryList();
      case "get":    return queryGet(id!);
      case "search": return querySearch(query!);
    }
  },
);
```

### Pattern: Write Guard

Require an explicit confirmation phrase for write operations:

```typescript
server.tool(
  "my_configure",
  "Write operation. Requires confirmation_phrase='apply_change'.",
  {
    action: z.enum(["create", "update", "delete"]),
    confirmation_phrase: z.literal("apply_change")
      .describe("Must be exactly 'apply_change' to proceed"),
    // ... other params
  },
  async ({ action, confirmation_phrase, ...params }) => {
    if (confirmation_phrase !== "apply_change") {
      throw new Error("confirmation_phrase must be exactly 'apply_change'");
    }
    // proceed with write
  },
);
```

---

## Resources and Prompts

### Resource Registration

```typescript
server.resource(
  "config",
  "config://app",
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(config) }],
  }),
);
```

### Prompt Registration

```typescript
server.prompt(
  "summarize",
  { text: z.string() },
  async ({ text }) => ({
    messages: [
      { role: "user", content: { type: "text", text: `Summarize: ${text}` } },
    ],
  }),
);
```

---

## Transport & Startup

### stdio Transport (standard for local MCP servers)

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  process.stderr.write(`[my-mcp] Starting v0.1.0\n`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[my-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
```

> **Important:** Use `process.stderr.write()` for logging — `console.log` writes to stdout which is the MCP transport channel.

---

## Client Configuration

### mcp_config.json (Antigravity)

```json
{
  "mcpServers": {
    "my-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/build/server.js"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
```

### For npm-published servers

```json
{
  "mcpServers": {
    "my-mcp-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"]
    }
  }
}
```

---

## Zod Schema Best Practices

| Do | Don't |
|---|---|
| Add `.describe()` to every parameter | Leave params undescribed |
| Use `z.enum()` for fixed options | Accept freeform strings for known options |
| Use `z.literal()` for confirmation gates | Trust the caller to provide correct values |
| Use `.optional().default()` for sensible defaults | Require params the user rarely needs |
| Validate inputs before processing | Trust inputs from the AI |
| Return structured JSON in `content[].text` | Return unstructured prose |

---

## Testing & Debugging

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/server.js
```

Opens a browser UI to test tool calls interactively.

### Manual stdio Testing

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node build/server.js
```

### Common Issues

| Problem | Cause | Fix |
|---|---|---|
| `console.log` breaks transport | stdout is the MCP channel | Use `process.stderr.write()` |
| Tool not appearing | Server not rebuilt | Run `npm run build` |
| Schema mismatch errors | v1/v2 API confusion | Check SDK version, use correct pattern |
| Connection timeout | Server crashes on startup | Check `stderr` output for errors |
| Parameters undefined | Missing `.describe()` | Add descriptions — AI needs them |

---

## Checklist

Before publishing an MCP server:

- [ ] All tools have descriptive names (snake_case) and descriptions
- [ ] All Zod parameters have `.describe()` annotations
- [ ] Write operations require an explicit confirmation gate
- [ ] `process.stderr.write` used instead of `console.log`
- [ ] `devices.example.json` or equivalent template committed
- [ ] Secrets read from environment variables, never hardcoded
- [ ] README includes `mcp_config.json` snippet
- [ ] Tested with MCP Inspector
- [ ] `npm run build` produces clean output
