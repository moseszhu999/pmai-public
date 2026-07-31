# PMAI Public CI

Public Hosted CI control plane for the private `moseszhu999/pmai` repository.

This repository contains only public-safe CI controllers, validation profiles, contract tests, and sanitized verification summaries. It is not a source-code mirror, deployment repository, or PMAI runtime.

## Boundary

- Private source is checked out read-only at an exact lowercase 40-character commit SHA.
- Checkout credentials are not persisted.
- Raw private command output remains runner-local and is deleted.
- Public output is limited to sanitized status and counts.
- No private source, migration, fixture, raw log, or build artifact is uploaded.
- No deployment, database write, pull-request merge, or private-repository mutation is performed.
