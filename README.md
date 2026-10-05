# Merforge

Merforge is a desktop application for personal and organization agent work. Its plugin-based foundation derives from DeepSeek Harness; upstream copyright and license notices remain in [LICENSE](LICENSE).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [user guide](docs/user/index.md) and [desktop guide](apps/desktop/README.md).

## Developer preview

Merforge is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run from source

The desktop application is the supported application entry:

```sh
pnpm install
pnpm run dev:desktop
```

Use `pnpm run build` and `pnpm run start:desktop` to launch already-built artifacts. The build selects the Desktop dependency set. See the [desktop guide](apps/desktop/README.md) for packaging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`make help` lists the desktop build and launch shortcuts.

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
