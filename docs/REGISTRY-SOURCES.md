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
