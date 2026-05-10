# Variant Builder Backend Core

The variant builder API exposes component variant structure without mutating source files. It is the backend foundation for future Studio and TUI editing workflows.

## Supported Detection

The parser detects:

- `cva(...)` definitions from `class-variance-authority`
- `tv(...)` definitions from `tailwind-variants`
- static base classes, value classes, default variants, and readable compound variants
- conservative manual maps such as `const buttonVariants = { primary: "..." }`
- conservative nested manual maps such as `const styles = { tone: { neutral: "..." } }`

Dynamic conditional expressions are reported as diagnostics instead of being guessed into axes.

## API

```bash
GET /api/variants/components
GET /api/variants/components/:identifier
POST /api/variants/preview
```

`GET /api/variants/components` returns component summaries with `path`, `name`, `variantCount`, `systems`, and axis names.

`GET /api/variants/components/:identifier` returns full variant definitions for one component, including axes, values, classes, defaults, compound variants, raw source, and diagnostics.

`POST /api/variants/preview` accepts `componentPath`, `targetDefinition`, and one operation:

- `add-axis`
- `add-value`
- `set-default`

The preview response includes `before`, `after`, `diff`, and `changes`. It does not write files, create backups, or apply edits. `before` and `after` contain the full source file content for preview/debug display, so consumers should prefer `diff` for compact rendering and avoid storing those full-source fields long term.

## Component Library Integration

Component library inventory and detail responses keep the existing `variantCount` field and add a `variants` summary for callers that need systems and axes without fetching the full variant detail endpoint.

## Type Notes

The variant parser exposes `ParsedVariantDefinition.variants` as an axis-to-value-to-classes map: `Record<string, Record<string, string[]>>`. Component library inventory items also include a required `variants` summary alongside `variantCount`. Consumers that compile against these shared backend types should treat both as part of the PR #67 interface update.

## Limitations

- Preview generation supports `cva` and `tv` definitions only.
- Manual maps are analysis-only.
- File-writing apply endpoints are intentionally deferred.
- Dynamic variant expressions remain unsupported until a later AST transform workflow can preserve intent safely.
