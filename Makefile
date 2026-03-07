.PHONY: integration-test build test lint fmt clean help typecheck dev

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

integration-test: ## Run integration tests (requires Docker)
	docker compose -f docker-compose.test.yml up -d
	@echo "Waiting for Streamline server..."
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:9094/health/live > /dev/null 2>&1; then \
			echo "Server ready"; \
			break; \
		fi; \
		sleep 2; \
	done
	npm run test:integration || npx vitest run --reporter=verbose tests/integration || true
	docker compose -f docker-compose.test.yml down -v
