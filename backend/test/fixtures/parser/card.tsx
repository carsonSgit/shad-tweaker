import { tv } from 'tailwind-variants';

const card = tv({
  base: 'rounded-lg border bg-card text-card-foreground shadow-sm',
  variants: {
    density: {
      compact: 'p-3 gap-2',
      comfortable: 'p-6 gap-4',
    },
    tone: {
      neutral: 'border-border',
      brand: 'border-primary/40',
    },
  },
  defaultVariants: {
    density: 'comfortable',
    tone: 'neutral',
  },
});

export function Card({ active }: { active: boolean }) {
  const dynamicClass = active ? 'ring-2' : undefined;

  return (
    <section className={dynamicClass}>
      <div className="flex items-center gap-2" />
    </section>
  );
}

export { card };
