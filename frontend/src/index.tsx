#!/usr/bin/env node
import { render } from 'ink';
import { App } from './App.js';
import type { WorkbenchArea } from './workbench.js';

// Handle graceful exit
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Allow the CLI to launch the TUI directly into a specific workflow area.
const initialArea = (process.env.SHADCN_INITIAL_AREA as WorkbenchArea) || undefined;

// Render the TUI
render(<App initialArea={initialArea} />);
