# Primitive Starter Adapters

Primitive starter adapters generate wrapper components from low-level UI primitives. They are intended for creating local component shells without treating primitive libraries as ready-made registry components.

## Supported Starters

| Provider | Template | Default output |
|----------|----------|----------------|
| `blank` | `blank-component` | `primitive-wrapper.tsx` |
| `radix` | `radix-dialog` | `dialog.tsx` |
| `base-ui` | `base-ui-dialog` | `dialog.tsx` |

Generated wrappers include `cn`, base Tailwind classes, and named slots or parts where the primitive exposes them. Radix and Base UI starters preserve accessibility behavior by delegating it to the underlying primitive.

## API

List available starter templates:

```bash
GET /api/primitive-starters
```

Preview generated files without writing:

```bash
POST /api/primitive-starters/preview
Content-Type: application/json

{
  "provider": "radix",
  "componentName": "Dialog",
  "includeCva": true
}
```

Apply generated files:

```bash
POST /api/primitive-starters/apply
Content-Type: application/json

{
  "provider": "blank",
  "componentName": "EmptyState",
  "targetPath": "empty-state.tsx"
}
```

If a target file already exists, apply fails unless `overwrite` is set to `true`.
