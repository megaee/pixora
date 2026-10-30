# Photo Cleanup — common tasks. Run `make help` to list them.
SHELL := /bin/bash
PY ?= python3
VENV := backend/.venv
BIN := $(VENV)/bin
FOLDER ?=

.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Create the Python venv, install backend + frontend dependencies
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -e "backend[dev]"
	cd frontend && npm ci

dev: ## Run backend (:8000, auto-reload) and frontend (:5173, hot reload) together
	@echo "Open http://localhost:5173  (Ctrl+C stops both)"
	@trap 'kill 0' INT TERM; \
	  PHOTO_CLEANUP_FOLDER="$(FOLDER)" $(BIN)/uvicorn photo_cleanup.api:create_app --factory \
	    --reload --reload-dir backend/src --port 8000 & \
	  (cd frontend && npm run dev) & \
	  wait

build: ## Build the React UI into the Python package
	cd frontend && npm run build

start: build ## Build the UI and run the app (make start FOLDER=~/Pictures/trip)
	$(BIN)/photo-cleanup $(FOLDER)

test: ## Run backend tests
	cd backend && .venv/bin/pytest -q

lint: ## Lint + type-check backend and frontend
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run typecheck && npm run format:check

format: ## Auto-format backend and frontend
	cd backend && .venv/bin/ruff check --fix . && .venv/bin/ruff format .
	cd frontend && npm run format

check: lint test build ## Everything CI runs

clean: ## Remove build output and caches
	rm -rf backend/src/photo_cleanup/static/assets backend/src/photo_cleanup/static/index.html \
	  frontend/node_modules/.vite backend/.pytest_cache backend/.ruff_cache

.PHONY: help setup dev build start test lint format check clean
