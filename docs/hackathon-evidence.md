# WebMCP Challenge development evidence

Qianshou was created during the WebMCP Challenge submission period. The official period opened on August 25, 2026. The repository's first commit is:

```text
dec3088  2026-08-29T06:34:08+08:00  feat: add accessible journey planning prototype
```

All current commits are dated between August 29 and September 2, 2026. The relevant progression is preserved in Git history:

| Commit | Evidence added |
| --- | --- |
| `dec3088` | Initial accessible journey prototype |
| `4e6e349` | Official journey data adapters |
| `4edecc1` | Real OpenTripPlanner routing |
| `9e6deda` | Taipei/New Taipei bus routing pipeline |
| `81c98a2` | Arrival data bound to the planned transit leg |
| `5a204d2` | TDX and OpenStreetMap place resolution |
| `bdecf86` | Simplified human/agent journey flow |
| `f0b259e` | Metro arrivals and route trade-offs |
| `9978a18` | Natural-language intent backend |
| `8704785` | Fresh current location when origin is omitted |
| `1b87b86` | Evidence levels for accessibility claims |
| `38b360c` | Removed functional runtime hardcodes |
| `2d00016` | Fresh location semantics for “here” in either direction |
| `8e40056` | Session-scoped journey interaction analytics |

The WebMCP implementation is visible in [`src/lib/webmcp/register-tools.ts`](../src/lib/webmcp/register-tools.ts). The live app exposes `prepare_accessible_journey`, `describe_current_location`, and `select_journey_alternative` through native `document.modelContext.registerTool` calls.

To reproduce the provenance check:

```bash
git log --reverse --format="%h %cI %s"
```
