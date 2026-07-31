# PMAI Public Exact-Head CI Contract

## Repositories

- Private source of truth: `moseszhu999/pmai`
- Public Hosted CI controller: `moseszhu999/pmai-public`

The public repository is not a mirror of private source and never publishes private source, migrations, fixtures, raw logs, or build artifacts.

## Dispatch contract

The generic dispatch accepts only:

- `privateExactSha`: lowercase 40-character commit SHA
- `expectedBaseSha`: lowercase 40-character exact merge base
- `expectedChangedFileCount`: non-negative integer
- `expectedMigrationCount`: non-negative integer
- `validationProfile`: fixed allowlisted profile

Branches, tags, short SHAs, pull-request refs, `HEAD`, `latest`, and arbitrary commands are rejected.

## Credential

Configure repository secret `PMAI_PRIVATE_READ_TOKEN` with read-only access limited to `moseszhu999/pmai`.

Preferred future form: short-lived GitHub App installation token. A temporary fine-grained token must be limited to repository metadata and contents read access and must not allow private-repository writes, Actions administration, deployments, Issues, or pull requests.

Without the secret, public controller contracts can pass, but private exact-head validation is expected to fail closed.

## Canonical baseline profile

The first fixed profile verifies:

- exact detached private head
- exact merge base
- exact changed-file count
- exact changed migration count
- no persisted checkout credential
- no Agent fallback from Agent identity to generic write identity
- no direct service-role or generic write-token reference in Agent semantic surfaces
- no raw GitHub, shell, or SQL execution tool exposed through Agent semantic surfaces
- no merge or production deployment command in those surfaces
- dependency installation
- full repository tests
- Engineering Director target lint
- production build without deployment

## Public evidence

The job summary exposes only exact SHAs, counts, fixed stage results, sanitized failure categories, and the final verdict. Raw private output is stored in mode-restricted runner-local files and deleted before the job concludes. No artifact is uploaded.

A PASS is valid only for the exact private SHA and validation profile shown in the run. A later private head makes the earlier evidence stale.
