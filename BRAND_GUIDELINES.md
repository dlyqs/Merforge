# Merforge brand assets

Merforge currently uses a temporary M mark and a system-font wordmark. These assets are placeholders for future brand artwork.

- Client mark and wordmark: `packages/client/ui-primitives/src/BrandMark.tsx` and `BrandWordmark.tsx`.
- Browser favicons: `apps/web/public/favicon.svg` and `favicon-dark.svg`.
- Desktop application icons: `apps/desktop/resources/icon*.svg` and their PNG exports.
- Installer artwork: `apps/desktop/installer/assets/brand*.svg`, their PNG exports, and `uninstaller-sidebar.png`.

Replace the artwork in these files while retaining their filenames, dimensions and component props. Update the filled client M path and both favicon paths together. Export Desktop platform SVGs as transparent 1024×1024 PNGs; export installer SVGs at their existing 1× and 2× dimensions. The Desktop packaging guide owns platform asset requirements.

The application name is Merforge in both supported locales. Upstream copyright, license notices, workspace package identifiers and model-provider protocol identifiers retain their original values.
