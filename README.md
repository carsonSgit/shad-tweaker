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

# Choose between the terminal workbench and browser studio
shadcn-tweaker studio

# Launch a specific studio surface
shadcn-tweaker studio --tui
shadcn-tweaker studio --web

# Launch the browser studio directly
shadcn-tweaker visual
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
| Primitive starters | Generate wrapper components from Radix, Base UI, or blank templates |
| Local Studio Shell | Browse Components, Registries, Tokens, Variants, Motion, Preview, Diff, Backups, and Settings |

## Studio Shell

`shadcn-tweaker studio` starts the local backend and lets you choose a surface:

- Terminal workbench: the existing Ink UI expanded with the full studio shell.
- Browser studio: a local Vite/React shell served by the backend at `/studio`.

The browser studio is local-only in this milestone. It exposes workbench navigation, project status, summaries, settings, and dirty-state visibility; hosted publishing, iframe previews, pixel inspection, and motion authoring belong to later milestones.

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

See [docs/PRIMITIVE-STARTERS.md](docs/PRIMITIVE-STARTERS.md) for primitive wrapper starter APIs.
See [docs/COMPONENT-LIBRARY.md](docs/COMPONENT-LIBRARY.md) for local component inventory and ownership APIs.

## License

MIT
