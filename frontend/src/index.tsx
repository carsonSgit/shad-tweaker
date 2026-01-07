#!/usr/bin/env node
import { render } from 'ink';
import { App } from './App.js';

// Handle graceful exit
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Render the TUI
render(<App />);
