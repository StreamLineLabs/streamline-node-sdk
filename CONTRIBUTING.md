# Contributing to Streamline Node.js SDK

Thank you for your interest in contributing to the Streamline Node.js SDK! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests and linting
5. Commit your changes (`git commit -m "Add my feature"`)
6. Push to your fork (`git push origin feature/my-feature`)
7. Open a Pull Request

## Prerequisites

- Node.js 18 or later
- npm

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/streamline-node-sdk.git
cd streamline-node-sdk

# Install dependencies
npm install

# Build (dual CJS + ESM via tsup)
npm run build

# Run tests
npm test
```

## Running Tests

```bash
# Run all tests (vitest)
npm test

# Run in watch mode
npx vitest --watch

# Run with coverage
npx vitest --coverage

# Run a specific test file
npx vitest src/__tests__/producer.test.ts
```

### Integration Tests

Integration tests require a running Streamline server:

```bash
# Start the server
docker compose -f docker-compose.test.yml up -d

# Run integration tests
npm test -- --run

# Stop the server
docker compose -f docker-compose.test.yml down
```

## Linting & Type Checking

```bash
# Lint
npm run lint

# Type check
npm run typecheck
```

## Code Style

- Follow existing TypeScript patterns in the codebase
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and short

## Pull Request Guidelines

- Write clear commit messages
- Add tests for new functionality
- Update documentation if needed
- Ensure `npm run build`, `npm test`, and `npm run lint` pass before submitting

## Reporting Issues

- Use the **Bug Report** or **Feature Request** issue templates
- Search existing issues before creating a new one
- Include reproduction steps for bugs

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](https://github.com/streamlinelabs/.github/blob/main/CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
