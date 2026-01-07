# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Instead, please email the maintainers directly or use GitHub's private vulnerability reporting feature
3. Include as much detail as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next scheduled release

### Security Best Practices for Users

1. **Keep dependencies updated**: Run `npm audit` regularly
2. **Use environment variables**: Never hardcode sensitive data
3. **Review permissions**: Ensure the CLI only has access to necessary directories
4. **Verify package integrity**: Check npm package signatures

## Automated Security

This project uses:
- **Dependabot**: Automated dependency updates
- **CodeQL**: Static code analysis for security vulnerabilities
- **npm audit**: Dependency vulnerability scanning in CI
- **Dependency Review**: PR-level dependency analysis

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities.
