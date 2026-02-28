# Streamline Node.js Native Bindings

N-API native bindings that embed the Streamline streaming engine directly in Node.js using napi-rs.

## Prerequisites

1. **Rust toolchain** — Install from https://rustup.rs
2. **libstreamline** — Build the shared library:
   ```bash
   cd ../../streamline
   cargo build --release --lib
   ```

## Building

```bash
npm run build
```

This produces `streamline.node` in the project root, which is loaded by `src/embedded.ts`.

## Usage

```typescript
import { EmbeddedStreamline } from 'streamline-sdk/embedded';

// Check if native module is available
if (EmbeddedStreamline.isAvailable) {
  const instance = new EmbeddedStreamline({ inMemory: true });
  await instance.produce('my-topic', Buffer.from('hello'));
  instance.close();
}
```

## Development

```bash
# Build in debug mode
cargo build

# Run tests
cargo test
```
