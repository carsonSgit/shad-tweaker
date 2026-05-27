# Pixel Inspector

Pixel Inspector is a local studio workflow for inspecting and tuning Tailwind classes on shadcn/ui components.

## Capabilities

- Analyze class names from static `className`, `cn(...)`, and supported `cva`/`tv` variant definitions.
- Group editable classes into spacing, radius, typography, border, color, shadow, focus ring, transform, duration, and easing controls.
- Preview class changes in the browser studio iframe without writing files.
- Save edits as component patches, token patches, reusable presets, or supported `cva`/`tv` variant values.

## API

- `POST /api/pixel-inspector/analyze`
- `POST /api/pixel-inspector/preview`
- `POST /api/pixel-inspector/apply`
- `GET /api/pixel-inspector/presets`
- `POST /api/pixel-inspector/presets`
- `DELETE /api/pixel-inspector/presets/:id`

Variant value saves use `POST /api/variants/apply`, which writes the same output returned by the existing variant preview generator and creates a backup first.
