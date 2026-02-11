.PHONY: build test lint fmt clean help typecheck dev

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: ## Build the SDK (CJS + ESM)
	npm run build

test: ## Run tests
	npm test

lint: ## Run linting
	npm run lint

typecheck: ## Run TypeScript type checking
	npm run typecheck

fmt: ## Format code (via eslint --fix)
	npm run lint -- --fix 2>/dev/null || true

clean: ## Clean build artifacts
	rm -rf dist/ node_modules/.cache

dev: install build ## Full dev setup
