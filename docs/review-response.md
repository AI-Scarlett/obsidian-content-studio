# Review response for 0.1.4

## Source and CSS

- The clipboard fallback narrowly supports Chromium’s legacy `copy` command, restores selection/focus and removes its temporary DOM. It cannot read the clipboard.
- Workbench HTML is sanitized into a DOM fragment before insertion. There are no direct innerHTML/outerHTML assignments in plugin source.
- DOM elements use Obsidian helpers. Dynamic styles use `setCssProps`/`setCssStyles`; fixed card geometry uses CSS classes. The rich-text exporter still serializes inline styles so external editors can retain formatting.
- The DNS fallback uses Obsidian `requestUrl`. Public URL validation, per-redirect address validation, pinned connections, time limits and size limits remain in place.
- UI timers use their owning window. Network timers explicitly belong to the Node request lifecycle.
- Persisted settings and DNS response records are narrowed from unknown values before use. Source no longer has `any`, an Electron `require()`, or unsafe error-member access.
- Settings implement searchable definitions for Obsidian 1.13+, with an imperative fallback for supported older versions.
- CSS contains no `!important`; host font variables replace unsupported extended system font keywords. Preview spacing uses the same article padding as copied HTML.
- The standalone browser prototype is not part of the plugin or its reviewed source. The Obsidian workbench remains in `src/ui/studio.ts`.

`npm run verify` requires zero ESLint and CSS warnings, runs type checking and 80 offline regression tests, and builds the plugin. No reported source rule is disabled. Separate test/runtime adapters are not shipped in the plugin.

## Release provenance

The version-tag workflow in `.github/workflows/release.yml` builds, checks and attests the release files before publishing. GitHub build-provenance attestations cover `main.js`, `styles.css` and `manifest.json`. Those are the only manually attached release assets. ZIP and checksum files are Actions artifacts, not release attachments.

Run `gh attestation verify <filename> --repo AI-Scarlett/obsidian-content-studio` against each downloaded file to verify its provenance. GitHub's automatically generated source archives are repository downloads, not extra plugin assets.

## Behavior explanations

| Reported behavior | Purpose and scope |
| --- | --- |
| Vault Enumeration | `ChooseNote.getItems()` calls `vault.getMarkdownFiles()` only when the user opens the note picker. It lists note paths for selection; it does not bulk-read note bodies or transmit paths. Startup/current-note formatting does not enumerate the Vault. |
| Clipboard Access | User-triggered copy buttons write title/body/thread content through `navigator.clipboard.write` or `writeText`; rich copy has a selection-based compatibility fallback. Per-image/card buttons write `image/png`. There is no clipboard read, watch or upload operation. |
| Vault Read | Reads the selected/current note and its referenced local image attachments through Vault APIs. |
| Vault Write | Exports into a new folder; retains the source note and previous packages. Settings remain in the plugin's data file. |

Enumeration and clipboard access are necessary for note selection and copying, so the behavior classifier may continue to describe them. They are not claims of clipboard reading or off-device Vault enumeration.

## Validation boundary

Local rule checks and tests do not imply marketplace approval. The Community portal must re-scan the updated default branch and 0.1.4 release. Actual WeChat/Zhihu paste-time image ingestion remains unverified; no auto-publishing or platform-media upload is implemented.
