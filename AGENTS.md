# Social Analytics workspace

- Social Analytics and its plugin cover all of the owner's social networks.
  Instagram is the first implemented integration; other platforms are not
  connected yet. Keep product naming broader than the current integration.
- Follow-up authorized in `docs/task-mcp-plugin-sites.md`: `chatgpt/` may host
  an MCP adapter and plugin on private Sites using the completed backend API.
  The backend-only/no-MCP restriction below describes the original backend task.
  Do not redeploy the backend or add storage for this follow-up.

- Node 24 and pnpm 11.15.1. Install at the workspace root; one lockfile.
- Backend only: one Cloudflare Worker, Hono, D1/Drizzle, OpenAPI 3.1.
- Use the official Instagram API with Instagram Login. No scraping, browser
  sessions, unofficial Instagram API, MCP server or ChatGPT plugin in this task.
- Keep the feature-first modular monolith in `backend/src/modules`.
  Cross-module imports use only `index.ts` or `public-contracts.ts`.
- Domain is pure: no I/O, runtime config, clocks or ID generation. Application
  coordinates capability-specific ports; infrastructure implements them;
  presentation invokes use cases. Compose modules through root factories.
- Do not add a DI framework, generic repositories, paid infrastructure,
  frontend, extra Worker, database, Queue, KV, R2, Redis or Docker.
- API values retain their source and collection time. Missing metrics are null,
  never invented zeroes. Document derived formulas and data limitations.
- Never print or commit OAuth codes, state, access tokens, API keys, credentials
  or .dev.vars. Invocation logs remain disabled.
- Apply generated migrations locally and run root `pnpm check` before handoff.
  Deployment, remote migrations and push require explicit authorization.
