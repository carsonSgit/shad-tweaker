# Tweaks Reference

Complete guide to all available quick tweaks for customizing shadcn components.

## Visual Styling

### Border Radius

Update `rounded-*` classes across components.

| Option | Value | Description |
|--------|-------|-------------|
| `rounded-none` | 0px | Sharp corners |
| `rounded-sm` | 2px | Small radius |
| `rounded` | 4px | Default |
| `rounded-md` | 6px | Medium |
| `rounded-lg` | 8px | Large |
| `rounded-xl` | 12px | Extra large |
| `rounded-2xl` | 16px | 2X large |
| `rounded-3xl` | 24px | 3X large |
| `rounded-full` | 50% | Pill/circle |

```tsx
// Before
<Button className="rounded-md bg-primary">Click me</Button>

// After (rounded-lg)
<Button className="rounded-lg bg-primary">Click me</Button>
```

---

### Ring Size

Update focus ring width for accessibility indicators.

| Option | Value | Description |
|--------|-------|-------------|
| `ring-0` | 0px | No ring |
| `ring-1` | 1px | Thin |
| `ring-2` | 2px | Default |
| `ring-4` | 4px | Thick |
| `ring-8` | 8px | Extra thick |

```tsx
// Before
<Input className="focus:ring-2 focus:ring-ring" />

// After (ring-4)
<Input className="focus:ring-4 focus:ring-ring" />
```

---

### Shadow

Update `shadow-*` classes for depth and elevation.

| Option | Description |
|--------|-------------|
| `shadow-none` | No shadow |
| `shadow-sm` | Subtle |
| `shadow` | Default |
| `shadow-md` | Medium |
| `shadow-lg` | Large |
| `shadow-xl` | Extra large |
| `shadow-2xl` | Huge |

```tsx
// Before
<Card className="shadow-md">Content</Card>

// After (shadow-lg)
<Card className="shadow-lg">Content</Card>
```

---

### Border Width

Update border thickness across components.

| Option | Value | Description |
|--------|-------|-------------|
| `border-0` | 0px | No border |
| `border` | 1px | Default |
| `border-2` | 2px | Medium |
| `border-4` | 4px | Thick |
| `border-8` | 8px | Extra thick |

```tsx
// Before
<Card className="border bg-card">Content</Card>

// After (border-2)
<Card className="border-2 bg-card">Content</Card>
```

---

### Opacity

Update `opacity-*` classes for transparency effects.

| Option | Description |
|--------|-------------|
| `opacity-0` | Invisible |
| `opacity-5` | 5% |
| `opacity-10` | 10% |
| `opacity-20` | 20% |
| `opacity-25` | 25% |
| `opacity-50` | Half |
| `opacity-75` | 75% |
| `opacity-90` | 90% |
| `opacity-100` | Full |

Use cases: disabled states, loading overlays, subtle backgrounds.

---

## Typography

### Text Size

| Option | Value | Description |
|--------|-------|-------------|
| `text-xs` | 12px | Extra small |
| `text-sm` | 14px | Small |
| `text-base` | 16px | Default |
| `text-lg` | 18px | Large |
| `text-xl` | 20px | Extra large |
| `text-2xl` | 24px | 2X large |

```tsx
// Before
<Button className="text-sm">Click me</Button>

// After (text-base)
<Button className="text-base">Click me</Button>
```

---

### Font Weight

| Option | Value | Description |
|--------|-------|-------------|
| `font-thin` | 100 | Thin |
| `font-extralight` | 200 | Extra light |
| `font-light` | 300 | Light |
| `font-normal` | 400 | Normal |
| `font-medium` | 500 | Medium |
| `font-semibold` | 600 | Semibold |
| `font-bold` | 700 | Bold |
| `font-extrabold` | 800 | Extra bold |
| `font-black` | 900 | Black |

```tsx
// Before
<h2 className="font-semibold">Heading</h2>

// After (font-bold)
<h2 className="font-bold">Heading</h2>
```

---

## Spacing

### Gap

Update `gap-*` classes for flexbox/grid spacing.

| Option | Value |
|--------|-------|
| `gap-0` | 0px |
| `gap-1` | 4px |
| `gap-2` | 8px |
| `gap-3` | 12px |
| `gap-4` | 16px |
| `gap-6` | 24px |
| `gap-8` | 32px |

```tsx
// Before
<div className="flex gap-2">
  <Button>One</Button>
  <Button>Two</Button>
</div>

// After (gap-4)
<div className="flex gap-4">
  <Button>One</Button>
  <Button>Two</Button>
</div>
```

---

### Padding

Update `p-*`, `px-*`, `py-*` classes.

| Option | Value |
|--------|-------|
| `p-0` | 0px |
| `p-1` | 4px |
| `p-2` | 8px |
| `p-3` | 12px |
| `p-4` | 16px |
| `p-6` | 24px |
| `p-8` | 32px |
| `p-10` | 40px |
| `p-12` | 48px |

Note: This replaces `p-*`, `px-*`, and `py-*` classes.

---

### Margin

Update `m-*`, `mx-*`, `my-*` classes.

| Option | Value |
|--------|-------|
| `m-0` | 0px |
| `m-1` | 4px |
| `m-2` | 8px |
| `m-3` | 12px |
| `m-4` | 16px |
| `m-6` | 24px |
| `m-8` | 32px |
| `m-10` | 40px |
| `m-12` | 48px |

---

## Animations & Transitions

### Transition Duration

Update `duration-*` classes.

| Option | Value |
|--------|-------|
| `duration-75` | 75ms |
| `duration-100` | 100ms |
| `duration-150` | 150ms (default) |
| `duration-200` | 200ms |
| `duration-300` | 300ms |
| `duration-500` | 500ms |
| `duration-700` | 700ms |
| `duration-1000` | 1000ms |

```tsx
// Before
<Button className="transition-colors duration-150">Hover me</Button>

// After (duration-300)
<Button className="transition-colors duration-300">Hover me</Button>
```

---

### Add Transitions

Adds `transition-colors` for smooth color changes.

```tsx
// Before
<Button className="bg-primary hover:bg-primary/90">Click</Button>

// After
<Button className="transition-colors bg-primary hover:bg-primary/90">Click</Button>
```

---

### Disable Animations

Removes all `animate-*` classes.

```tsx
// Before
<Spinner className="animate-spin" />

// After
<Spinner className="" />
```

Use cases: respect motion preferences, performance, accessibility.

---

## Class Transformations

### Remove Class

Remove specific Tailwind classes:

- `cursor-pointer`
- `cursor-default`
- `transition`
- `transition-all`
- `transition-colors`
- `animate-pulse`
- `animate-spin`
- `outline-none`
- `pointer-events-none`
- `select-none`
- All shadows

---

### Use focus-visible

Changes `focus:` to `focus-visible:` for better keyboard UX.

```tsx
// Before
<Button className="focus:ring-2 focus:ring-ring">Click</Button>

// After
<Button className="focus-visible:ring-2 focus-visible:ring-ring">Click</Button>
```

Result: Focus ring shows for keyboard users, not mouse clicks.

---

### Use group-hover

Changes `hover:` to `group-hover:` for parent-triggered hover states.

```tsx
// Before
<div className="group">
  <Icon className="hover:text-primary" />
</div>

// After
<div className="group">
  <Icon className="group-hover:text-primary" />
</div>
```

---

### Use peer-focus

Changes `focus:` to `peer-focus:` for sibling-triggered focus states.

```tsx
// Before
<div>
  <Input className="peer" />
  <Label className="focus:text-primary">Name</Label>
</div>

// After
<div>
  <Input className="peer" />
  <Label className="peer-focus:text-primary">Name</Label>
</div>
```

---

### Add Dark Mode Classes

Duplicates `bg-` classes with `dark:bg-` prefix.

```tsx
// Before
<Card className="bg-white border-gray-200">Content</Card>

// After
<Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700">Content</Card>
```

Note: Manual color adjustment may be needed.

---

## Common Workflows

### Make Components Rounded

1. Select components
2. Choose "Change Border Radius"
3. Select `rounded-lg` or `rounded-xl`

### Subtle UI

1. Change Shadow → `shadow-sm`
2. Change Border Width → `border`
3. Change Opacity → `opacity-90`

### Improve Accessibility

1. Use focus-visible
2. Change Ring Size → `ring-2`
3. Add Transitions

### Bold Design

1. Change Font Weight → `font-semibold`
2. Change Border Width → `border-2`
3. Change Shadow → `shadow-lg`

---

## Quick Reference

| Property | Small | Medium | Large |
|----------|-------|--------|-------|
| Rounded | `rounded-sm` (2px) | `rounded-md` (6px) | `rounded-xl` (12px) |
| Shadow | `shadow-sm` | `shadow-md` | `shadow-xl` |
| Border | `border` (1px) | `border-2` (2px) | `border-4` (4px) |
| Text | `text-sm` (14px) | `text-base` (16px) | `text-xl` (20px) |
| Gap | `gap-2` (8px) | `gap-4` (16px) | `gap-8` (32px) |
| Padding | `p-2` (8px) | `p-4` (16px) | `p-8` (32px) |

---

## Custom Templates

Create custom templates for:

- Multi-step transformations
- Project-specific patterns
- Team coding standards

Press `[n]` in the Template Manager to create your own templates.
