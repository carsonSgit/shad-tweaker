# Sample Components

This folder gives the local studio a tiny component set for trying Pixel Inspector without wiring a separate app.

When no component directory is configured or auto-detected, the studio falls back to this
`samples/components/ui` set automatically, so the sandbox always opens with editable content.
You can still point it at your own components explicitly with `--path`.

Run the browser studio against these samples:

```powershell
bun run build:backend
bun run build:frontend
bun run build:web
bun run cli/index.ts studio --web --path samples/components/ui --port 4101 --no-open
```

Open the printed `/studio` URL, choose **Inspector**, and try edits such as:

- `rounded-md` to `rounded-xl` on Button
- `p-6` to `p-8` on Card
- `shadow-sm` to `shadow-lg` on Badge

The samples are self-contained TSX components so the preview server can render them directly.
