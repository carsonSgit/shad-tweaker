export type CardProps = {
  className?: string;
  density?: 'compact' | 'comfortable';
};

const densityClasses = {
  compact: 'p-4 gap-3',
  comfortable: 'p-6 gap-5',
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function Card({ className, density = 'comfortable' }: CardProps) {
  return (
    <section
      className={cx(
        'grid w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-md transition duration-300 ease-in-out hover:-translate-y-1 hover:shadow-xl',
        densityClasses[density],
        className
      )}
    >
      <div className="grid gap-1">
        <h3 className="text-lg font-semibold tracking-tight">Sample Card</h3>
        <p className="text-sm text-muted-foreground">
          Tweak radius, padding, color, border, shadow, transform, and typography here.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs font-medium">
        Pixel Inspector playground
      </div>
    </section>
  );
}
