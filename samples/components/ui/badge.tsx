export type BadgeProps = {
  className?: string;
  tone?: 'info' | 'success' | 'warning';
};

const toneClasses = {
  info: 'border-blue-300 bg-blue-50 text-blue-700 ring-blue-200',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-800 ring-amber-200',
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function Badge({ className, tone = 'info' }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex h-7 w-fit items-center gap-1 rounded-full border px-3 text-xs font-semibold tracking-wide shadow-sm ring-1 transition duration-150 ease-out',
        toneClasses[tone],
        className
      )}
    >
      Sample Badge
    </span>
  );
}
