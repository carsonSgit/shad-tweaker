type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const colors = {
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, _message: string, meta?: unknown): void {
  const color = colors[level];
  const _timestamp = formatTimestamp();
  const _prefix = `${color}[${level.toUpperCase()}]${colors.reset}`;

  if (meta !== undefined) {
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
};
