# Component Library

The component library API turns local UI files into an owned inventory. It builds on the configured workspace component directory and keeps legacy component scan endpoints available.

## Inventory

```bash
GET /api/components/library/inventory
```

Returns local components with:

- `name`
- `sourceRegistry`
- `primitiveBase`
- `variantCount`
- `lastModified`
- `dependencyStatus`
- `tokenUsage`
- `filePath`

## Detail And Duplicates

```bash
GET /api/components/library/detail/:identifier
GET /api/components/library/duplicates
```

Details include content, exports, dependencies, and source ownership metadata when available. Duplicate reports cover name, export, and dependency collisions, with suggested suffixes such as `button-linear`, `button-minimal`, and `button-acme`.

## Ownership Actions

```bash
POST /api/components/library/:identifier/rename
POST /api/components/library/:identifier/fork
POST /api/components/library/:identifier/detach
POST /api/components/library/:identifier/reset
GET  /api/components/library/:identifier/compare
```

Rename and fork accept `{ "name": "new component name" }`. Detach removes source ownership metadata. Reset and compare use source metadata when the component was imported with a safe local source path. Compare returns a unified `diff` plus `localContent` and `sourceContent` snapshots for callers that need the raw text.
