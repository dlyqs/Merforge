# Short names for the Desktop application commands.
.DEFAULT_GOAL := help
.PHONY: help build desktop dev-desktop

PNPM ?= pnpm
ARGS ?=

help:
	@echo "make build        pnpm run build           Desktop dependency build"
	@echo "make desktop      pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-desktop  pnpm run dev:desktop     build, then launch Desktop"

build:
	$(PNPM) run build

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-desktop:
	$(PNPM) run dev:desktop $(ARGS)
