# Auto-Versioning

This project uses automatic versioning based on pull request merges to the main branch.

## How It Works

When a pull request is merged to the `main` or `master` branch:

1. The auto-versioning workflow analyzes the PR title and body
2. Determines the appropriate version bump (major, minor, or patch)
3. Updates version in all package.json files
4. Commits the version change
5. Creates and pushes a git tag
6. Triggers the release workflow automatically

## Version Bump Rules

The workflow determines the version bump type based on PR title keywords:

### Major Version (x.0.0)
**Breaking changes** - Use when making incompatible API changes
- PR title contains: `BREAKING CHANGE`, `breaking change`, or `major`
- PR body contains: `BREAKING CHANGE`

**Examples:**
- `BREAKING CHANGE: Redesign CLI interface`
- `major: Remove deprecated API endpoints`

### Minor Version (0.x.0)
**New features** - Use when adding functionality in a backwards-compatible manner
- PR title starts with: `feat`, `feature`, or contains `minor`

**Examples:**
- `feat: Add new component preview mode`
- `feature: Implement theme switching`

### Patch Version (0.0.x)
**Bug fixes and minor changes** - Default for all other changes
- PR title starts with: `fix`, `bugfix`, `patch`, `chore`, `docs`, `refactor`, `test`, or `ci`
- Any PR that doesn't match major or minor rules

**Examples:**
- `fix: Resolve component rendering issue`
- `chore: Update dependencies`
- `docs: Improve README`
- `refactor: Clean up code structure`

## Best Practices

### PR Title Format
Follow conventional commit format for your PR titles:
```
<type>: <description>

Examples:
feat: Add dark mode support
fix: Resolve rendering bug in preview
chore: Update build configuration
```

### Common Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `chore`: Maintenance tasks
- `refactor`: Code refactoring
- `test`: Adding tests
- `ci`: CI/CD changes

### Breaking Changes
For breaking changes, include `BREAKING CHANGE:` in your PR title or body:
```
BREAKING CHANGE: Redesign configuration format

The configuration file format has been completely redesigned.
Users will need to migrate their existing configs.
```

## Manual Override

If you need to manually create a release:

1. Update version in package.json files manually
2. Create a git tag: `git tag -a v1.2.3 -m "Release v1.2.3"`
3. Push the tag: `git push origin v1.2.3`
4. The release workflow will trigger automatically

## Skipping Auto-Versioning

If you need to merge a PR without triggering auto-versioning, you can:
1. Close the PR without merging, make changes directly on main
2. Or merge the PR and manually revert the version bump commit

Note: This should be avoided in normal workflows.

## Version History

All releases are tracked via git tags and GitHub releases. You can view the version history:
- Git tags: `git tag -l`
- GitHub: Navigate to the Releases page in the repository
