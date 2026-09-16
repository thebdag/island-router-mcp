# MCP patterns — progressive tool calling

Load when implementing catalog/describe discovery, slim invoke schemas, or structured action errors.

## Why

`tools/list` is injected into every model turn. Per-action fields on meta-tools (`mac`, `led_level`, …) cost tokens even when unused. Progressive calling keeps invoke tools tiny and discloses one action’s schema on demand.

## Tools

| Tool | When | Schema |
| --- | --- | --- |
| `*_list` / inventory | Always cheap | none or id only |
| `*_actions` | Catalog or describe | `query?`, `kind?`, `action?` |
| `*_query` | Read invoke | `device_id`, `action` enum, `params` |
| `*_configure` | Write invoke | + `confirmation_phrase: "apply_change"` |

Do not add a new top-level tool per action. Do not put per-action fields on invoke tools.

## Catalog vs describe

```typescript
// No action → compact catalog
listActions({ query, kind })
// { count, actions: [{ name, kind, summary, required[] }], help[] }
// empty: actions: "0 actions matched '…'"

// action set → full spec
formatDescribe(describeAction(name))
// { name, kind, invoke, summary, params[], example, confirmation_phrase? }
```

This repo: specs in `src/core/actionCatalog.ts`. Handlers stay in `query.ts` / `configure.ts`.

## Slim invoke

```typescript
server.tool("island_query", "Read-only. Call island_actions for schemas.", {
  device_id: z.string().describe("Device ID from inventory"),
  action: z.enum(QUERY_ACTIONS).describe("Query action to perform"),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe("Action fields. Call island_actions with action=<name>."),
}, async ({ device_id, action, params }) => {
  const spec = describeAction(action);
  const picked = pickActionParams(spec, params);
  return text(await dispatchQuery(dev, picked as unknown as QueryParams));
});
```

`pickActionParams` copies catalog-known keys only and rejects extras / type mismatches.

## Error payload (return JSON, do not throw)

```json
{
  "error": "'mac' required",
  "action": "add_dhcp",
  "required": ["mac", "ip"],
  "optional": ["hostname"],
  "example": { "mac": "aa:bb:cc:dd:ee:ff", "ip": "192.168.1.50", "hostname": "nas" },
  "help": "Call island_actions with action='add_dhcp' for the full schema"
}
```

Writes still require `confirmation_phrase: "apply_change"` at the top level, never inside `params`.

## Adding an action

1. Handler + `QUERY_ACTIONS` / `CONFIGURE_ACTIONS`
2. `ActionSpec` in `actionCatalog.ts` (summary, params, example)
3. AXI presentation if the action is dual-surface
4. Do **not** extend invoke Zod objects
