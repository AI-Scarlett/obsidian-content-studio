# Verification scope for 0.1.7 preview / browser assistant 0.3.0

The current build passes 95 plugin tests with zero-warning Obsidian ESLint, CSS lint, TypeScript and production build checks. The companion adds 41 tests and its own TypeScript/build checks. Run `npm run verify`, `npm run verify:extension`, then `npm run package`.

The new checks cover platform-specific media delivery: three-image Tiptap and Draft.js document order; preservation of uploaded media metadata; title-first writing; duplicate and unresolved uploads; X media IDs in addition to decoded images; cancellation and native file-picker method restoration; old-extension protocol rejection before claiming a task; login preservation; X Create-only navigation; and WeChat actual-file request payloads, exact returned draft navigation, and no retry after uncertain draft creation. Network and uploader substitutes are used. Passing these tests does not establish that a live account accepted or saved the article.

The 0.1.7 source and companion folder are intended for local preview installation, preserving plugin settings and source notes. Reloading installed runtimes must be checked separately from file hashes. Browser tool policy blocked extension management, companion pages and the WeChat editor in this session, so automated runtime reload and real-platform acceptance remain unverified. No final publication is performed. The preview does not replace the marketplace release until platform acceptance. See [adapter research and implementation](publishing-adapter-research.md) and [release notes](releases/0.1.7.md).

## Historical 0.1.4 checks

The following observations apply to the earlier build and are retained as historical evidence, not as fresh 0.1.7 acceptance.

`npm run verify` runs the official Obsidian ESLint recommended rules with zero warnings, conservative Chrome 120 CSS compatibility checks, TypeScript, 80 offline tests and a production bundle build. `npm run package` validates and packages the three plugin files.

Regression coverage includes rendering and sanitization, templates, network and redirect protections, image cache/order/retry/completeness, title/body copying, separate media delivery, draft retention across workspace modes, collapsed-drawer visibility, native DOCX XML/media relationships, relative font sizes, compiled plugin host behavior, settings, note enumeration and write-only clipboard access.

Browser checks used the current Studio source with an isolated local host and synthetic content. At 600 px the editor measured 560 × 360 px in a 780 px tall pane. 380/600/1100 px panes showed no horizontal overflow. Editing, preview and wide comparison modes, the template drawer, and the image export options were exercised. A five-card export produced 1080 × 1440 PNGs; all five were visually inspected. A 3,680-character unbroken paragraph plus a final image and end marker paginated to 15 cards without dropping the final content.

The Word export was created through the actual Studio export action using PNG and WebP source images. The DOCX embeds two native media parts, keeps body text and images in source order, and excludes the generated article title. Its two pages were rendered with the bundled LibreOffice renderer using a task-local fontconfig file for Chinese fonts and visually inspected. XML tests additionally cover repeated images, tables, links, invalid images and dark-template readability on white pages.

The 0.1.4 clipboard changes were checked against the current six-theme Shanhai generator: it writes rich HTML first, falling back to a native selection; its per-image flow converts decoded pixels to PNG. The current Shanhai output uses data URLs, without an upload step.

The actual Studio copy buttons were exercised in an isolated local Chrome page with synthetic PNG/WebP images. Browser automation uses a virtual clipboard bridge: paste events received `text/html` plus `text/plain`, two embedded images in order, no generated title and no copy controls, for both WeChat and Xiaohongshu modes. The per-image action delivered a 45,448-byte PNG file (960 × 400); copying a text-and-image card delivered a 114,095-byte PNG (1080 × 1440), visually inspected. This verifies browser API payloads and local paste handling, not the native macOS pasteboard or destination upload. Native selection fallback, failure cleanup, no silent plain-text downgrade and cursor restoration have offline DOM tests. A 380 px pane retained all copy controls without horizontal overflow.

These checks do not assert destination acceptance. Browser policy prevented access to the WeChat editor; no platform import/upload or publication was performed. Native Obsidian was observed running the 0.1.3 workspace before this update. Installed file verification and release provenance do not imply that the running plugin has been reloaded. Preserve/export temporary drafts before reloading.

Private notes, vault paths, local screenshots and machine logs are excluded from source control. Release assets are restricted to `main.js`, `manifest.json`, `styles.css`, with attestations from the tagged release workflow. Community review remains external.
