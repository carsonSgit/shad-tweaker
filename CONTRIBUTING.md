# Contributing to shadcn-tweaker

Thank you for your interest in contributing! This document provides guidelines and steps for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something great together.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- Git

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/shad-tui.git
   cd shad-tui
   ```

3. Install dependencies:
   ```bash
   bun install
   cd backend && bun install && cd ..
   cd frontend && bun install && cd ..
   ```

4. Build the project:
   ```bash
   bun run build
   ```

5. Run in development mode:
   ```bash
   bun run dev
   ```

## Development Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `chore/` - Maintenance tasks

### Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style guidelines

3. Run Biome check (lint + format):
   ```bash
   bun run check
   ```

4. Auto-fix issues:
   ```bash
   bun run check:fix
   ```

5. Type check:
   ```bash
   bun run typecheck
   ```

6. Build to ensure everything compiles:
   ```bash
   bun run build
   ```

### Available Scripts

| Command | Description |
|---------|-------------|
| `bun run build` | Build all packages |
| `bun run dev` | Run CLI in development mode |
| `bun run check` | Run Biome linter + formatter check |
| `bun run check:fix` | Auto-fix all Biome issues |
| `bun run lint` | Run Biome linter only |
| `bun run format` | Format all files |
| `bun run typecheck` | TypeScript type checking |

### Commit Messages

Follow conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(cli): add new template export command
fix(backend): resolve file path issue on Windows
docs: update installation instructions
```

### Pull Requests

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill out the PR template completely
4. Wait for CI checks to pass
5. Address any review feedback

## Project Structure

```
shad-tui/
├── cli/              # CLI entry point
├── backend/          # Express server for file operations
│   └── src/
│       ├── routes/   # API endpoints
│       ├── services/ # Business logic
│       └── utils/    # Utilities
├── frontend/         # Ink TUI interface
│   └── src/
│       ├── components/  # UI components
│       ├── hooks/       # Custom hooks
│       └── api/         # Backend client
├── docs/             # Documentation
└── .github/          # CI/CD configuration
```

## Code Style

This project uses [Biome](https://biomejs.dev) for both linting and formatting.

- Use TypeScript for all new code
- Run `bun run check:fix` before committing
- Prefer functional components for React/Ink
- Use meaningful variable and function names
- Add comments for complex logic

## Testing

Currently, the project doesn't have a test suite. If you'd like to contribute tests, that would be greatly appreciated!

## Questions?

Feel free to open an issue for questions or discussions about contributing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
