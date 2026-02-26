# Changelog

All notable changes to this project will be documented in this file.
- feat: add TypeScript generic types for message values

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- **Fixed**: handle ECONNRESET in broker connection
- **Changed**: update tsup build configuration
- **Changed**: consolidate CJS and ESM entry points
- **Testing**: add vitest suite for producer serialization
- **Fixed**: resolve ESM import path resolution
- **Added**: add typed event emitter for consumer messages

### Fixed
- Resolve type inference for consumer options

### Changed
- Update tsup configuration for tree shaking
- Consolidate error handling in producer

## [0.2.0] - 2026-02-18

### Added
- `StreamlineClient` with auto-reconnection and exponential backoff
- `Producer` with batching, linger timer, and key-based partitioning
- `Consumer` with `AsyncIterable<Message>` support (`for await...of`)
- `Admin` client for topic, consumer group, and ACL management
- Strict TypeScript with all advanced checks enabled
- Clean error hierarchy with retryable flags
- Dual CJS/ESM output via tsup
- SASL and TLS connection support
- 100+ unit tests across 5 test suites

### Infrastructure
- CI pipeline with vitest, coverage reporting, and Node.js matrix (18, 20, 22)
- CodeQL security scanning
- Release workflow with npm publishing
- Release drafter for automated release notes
- Dependabot for dependency updates
- CONTRIBUTING.md with development setup guide
- Security policy (SECURITY.md)
- EditorConfig for consistent formatting
- ESLint with TypeScript strict rules
- Issue templates for bug reports and feature requests

## [0.1.0] - 2026-02-18

### Added
- Initial release of Streamline Node.js/TypeScript SDK
- Dual CJS + ESM output via tsup
- Full TypeScript type definitions
- Apache 2.0 license
