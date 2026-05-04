# Registry Sources (Milestone 2)

Backend registry read endpoints are exposed under `/api/workspace` and are designed to degrade safely when some sources are unavailable.

## Endpoints

- `GET /api/workspace/registry-sources`
  - Lists configured manifest sources.
- `GET /api/workspace/registry-sources/health`
  - Returns per-source health status and issues.
- `GET /api/workspace/registry-items`
  - Returns merged registry item summaries from enabled sources plus source warnings.
- `GET /api/workspace/registry-items/:itemName`
  - Finds the first matching item by name across enabled sources.
- `GET /api/workspace/registry-items/:sourceId/:itemName`
  - Returns one normalized internal `ComponentPackage` shape.

## Degraded-source behavior

- Source failures are returned as structured warnings/issues.
- A single source failure does not fail global list/health reads.
- Invalid source identifiers or item names are treated as not found in item fetch flows.

## Health checks

`GET /api/workspace/registry-sources/health` returns one health entry per configured source:

- `healthy`: no issues were found.
- `degraded`: the source has a configuration, disabled-state, or local filesystem issue.
- `unhealthy`: a remote health lookup failed because the request errored or returned a non-2xx HTTP status.

Source-specific checks:

- `shadcn-registry` and `url-list` sources require a valid `registryJsonUrl`. The backend fetches that URL with a timeout and reports invalid URLs, network failures, timeouts, and non-2xx responses as structured issues.
- `local-folder` sources require `baseUrl` to be a safe project-relative path that exists and is a directory.
- `npm-package` sources use `baseUrl` as the package name and check `https://registry.npmjs.org/<encoded package name>`. A 2xx response means the package is available enough for health purposes; no install or filesystem mutation is attempted.
- Disabled sources report `SOURCE_DISABLED` and skip remote lookups.
