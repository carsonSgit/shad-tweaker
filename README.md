# shadcn-tweaker

A terminal UI for batch customizing [shadcn/ui](https://ui.shadcn.com) components. Select components, pick tweaks, preview changes, and apply them all at once.

## Install

```bash
npm install -g shadcn-tweaker
```

## Usage

```bash
# Initialize in your project
shadcn-tweaker init

# Launch the TUI
shadcn-tweaker
```

## What It Does

| Action | Result |
|--------|--------|
| Select components | Pick one or multiple shadcn components to modify |
| Choose tweaks | Apply quick transformations to Tailwind classes |
| Preview changes | See diffs before applying |
| Apply changes | Batch update all selected components |
| Save templates | Reuse tweak combinations across projects |
| Auto-backup | Restore original files anytime |

## Available Tweaks

| Category | Options |
|----------|---------|
| Border Radius | `rounded-none` to `rounded-full` |
| Shadow | `shadow-none` to `shadow-2xl` |
| Border Width | `border-0` to `border-8` |
| Ring Size | `ring-0` to `ring-8` |
| Text Size | `text-xs` to `text-2xl` |
| Font Weight | `font-thin` to `font-black` |
| Spacing | `gap-*`, `p-*`, `m-*` values |
| Transitions | Add/remove, adjust duration |
| Class transforms | `focus-visible:`, `group-hover:`, dark mode |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j/k` | Navigate up/down |
| `Space` | Toggle selection |
| `Enter` | Confirm |
| `Tab` | Switch panels |
| `q` | Quit |

## Requirements

- Node.js 18+
- A project with shadcn/ui components

## Contributing

This project uses automatic versioning. When submitting pull requests, use conventional commit format in your PR title:
- `feat:` for new features (minor version bump)
- `fix:` for bug fixes (patch version bump)
- `BREAKING CHANGE:` for breaking changes (major version bump)

See [docs/VERSIONING.md](docs/VERSIONING.md) for more details.

## License

MIT
