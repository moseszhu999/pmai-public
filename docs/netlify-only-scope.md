# PMAI Netlify-only development scope

Netlify is the only active deployment and preview platform for the current PMAI development slice.

- Active MCP endpoint: `https://netlify-mcp.netlify.app/mcp`
- Dedicated development site: `pmai-dev-mcp`
- Site ID: `151d27a2-80b8-4d6a-be6c-794c08a73f9f`
- Production actions: disabled
- Vercel integration: deferred

The public CI profile continues to validate exact private head, exact merge base, six-file scope, zero migrations, Netlify MCP setup, exact-SHA deployment evidence, focused tests, target lint, and production build without deployment.
