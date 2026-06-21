export type ButtonProps = {
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

const variantClasses = {
  default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
  outline: 'border border-input bg-background text-foreground shadow-sm hover:bg-accent',
  ghost: 'bg-transparent text-foreground hover:bg-accent',
};

const sizeClasses = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 py-2 text-sm',
  lg: 'h-12 px-6 text-base',
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function Button({
  className,
  disabled,
  loading,
  variant = 'default',
  size = 'md',
}: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md border-2 ring-offset-background transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        loading && 'animate-pulse',
        className
      )}
      disabled={disabled || loading}
      type="button"
    >
      {loading ? 'Saving...' : 'Sample Button'}
    </button>
  );
}
