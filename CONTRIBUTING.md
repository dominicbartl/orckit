# Contributing to Orckit

Thank you for your interest in contributing to Orckit! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions with the project and community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/orkkit.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b feature/my-feature`

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- tmux (for testing tmux integration)

### Building

```bash
# Build the project
pnpm build

# Build in watch mode
pnpm build:watch
```

### Testing

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests with UI
pnpm test:ui
```

### Linting

```bash
# Check for lint errors
pnpm lint

# Fix lint errors automatically
pnpm lint:fix

# Check code formatting
pnpm format:check

# Fix formatting
pnpm format
```

## Project Structure

```
src/
├── cli/              # CLI entry point and commands
├── core/             # Core orchestration logic
│   ├── config/       # Configuration parsing and validation
│   ├── dependency/   # Dependency resolution
│   ├── health/       # Health check implementations
│   ├── hooks/        # Pre/post hook execution
│   ├── preflight/    # Preflight checks
│   ├── boot/         # Boot sequence logging
│   ├── tmux/         # tmux integration
│   └── status/       # Status monitoring
├── runners/          # Process runner implementations
├── plugins/          # Build tool plugins (webpack, vite, angular)
├── utils/            # Utility functions
└── types/            # TypeScript type definitions
```

## Making Changes

### Adding a New Feature

1. Check existing issues and discussions
2. Create an issue to discuss the feature
3. Wait for maintainer approval
4. Implement the feature with tests
5. Update documentation
6. Submit a pull request

### Fixing a Bug

1. Check if an issue already exists
2. Create an issue if it doesn't exist
3. Reference the issue in your PR
4. Include tests that verify the fix
5. Submit a pull request

### Coding Standards

- Follow the existing code style
- Use TypeScript strict mode
- Write JSDoc comments for public APIs
- Keep functions small and focused
- Use meaningful variable names
- Prefer composition over inheritance

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
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

Examples:
```
feat(runners): add python runner support
fix(health): correct TCP health check timeout
docs(readme): update installation instructions
```

### Testing Guidelines

- Write unit tests for new functionality
- Ensure all tests pass before submitting
- Aim for >80% code coverage
- Test edge cases and error conditions
- Use descriptive test names

Example:
```typescript
describe('DependencyResolver', () => {
  it('should detect circular dependencies', () => {
    // Test implementation
  });

  it('should handle missing dependencies gracefully', () => {
    // Test implementation
  });
});
```

### Documentation

- Update README.md for user-facing changes
- Update CLAUDE.md for architecture changes
- Add JSDoc comments for new APIs
- Create/update documentation files in `docs/`
- Include usage examples

## Pull Request Process

1. **Update your branch**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Ensure all checks pass**
   - Build succeeds
   - All tests pass
   - No lint errors
   - Code coverage maintained

3. **Update documentation**
   - README if needed
   - Relevant docs/ files
   - JSDoc comments

4. **Create the PR**
   - Use the PR template
   - Link related issues
   - Provide clear description
   - Add screenshots if applicable

5. **Respond to feedback**
   - Address reviewer comments
   - Push updates to your branch
   - Request re-review when ready

## Release Process

Releases are automated via GitHub Actions:

1. Ensure `main` branch is stable
2. Update version in `package.json`
3. Create a git tag: `git tag v0.1.0`
4. Push tag: `git push origin v0.1.0`
5. GitHub Actions will:
   - Run all tests
   - Build the package
   - Create a GitHub release
   - Publish to npm

## Getting Help

- Open an issue for bugs or feature requests
- Check existing documentation
- Look at similar projects for inspiration

## Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes
- Project README (for significant contributions)

Thank you for contributing to Orckit! 🎭
