# Verification scope for 0.1.12 preview / browser assistant 0.3.5

## X delayed image placement

The 0.3.5 adapter retains the original layout and reconciles existing native media blocks before the final position audit. Model tests cover repeated delayed moves of two images to the end, restored markers, native marker splitting, cancellation and changed text. A 2.5-second stable layout interval is bounded by 15 seconds; this is not a server autosave acknowledgment. Live read-only inspection of a fresh saved draft and its Preview showed its two images at the original paragraph positions; the reported end placement was not reproduced there. Complete new-adapter upload, browser reload and autosave/reopen acceptance are still pending. See [0.1.12 notes](releases/0.1.12.md).

## Zhihu and X image routes

Live inspection found a Zhihu material-library dialog with a separate image input; the editor also exposes its own dedicated body-image input. X had one decoded blob preview at the end and all three markers remaining. Opening the saved X draft in a fresh tab retained that image with a new blob URL. The native X create control opened a blank editor, which was subsequently removed. The 0.3.4 corrections and their limits are recorded in [0.1.11 notes](releases/0.1.11.md). Complete multi-image delivery by the new adapter is not yet live-verified. Extension-management and upload automation restrictions have not been bypassed.

## Browser toolbar wakeup

The new icon route requests `obsidian://content-studio`; the plugin waits for workspace restoration and preserves existing workbench edits. 98 plugin tests and 48 companion tests pass. Native settings show 0.1.10 enabled; a newly opened workbench has the same complete Markdown and title as before the update, with 3/3 images loaded. Companion 0.3.3 files are deployed but its browser reload and toolbar wakeup have not been verified. A browser URI-link attempt produced no confirmed native transition. Cold application startup remains unverified. See [0.1.10 notes](releases/0.1.10.md).

The current build is checked by 98 plugin tests and 59 companion tests, plus zero-warning Obsidian ESLint, CSS lint, TypeScript and production builds. Run `npm run verify`, `npm run verify:extension`, then `npm run package`.

The companion tests serialize every Draft.js state update, round-trip title/body/media documents and link ranges with emoji, reject DOM seed writes, and exercise the current Xiaohongshu image-array contract with upload completion preceding node insertion. Failure, cancellation, duplicate uploads, old protocols, draft preservation and no final publication remain covered. Uploaders are test substitutes; the checks do not establish real-account success.

Live read-only inspection of the user's failed drafts found a Xiaohongshu blob image at progress zero, a Zhihu seed character with a React reconciliation exception, and X entity lookup errors with no body images. The corrections and evidence boundaries are recorded in [0.1.9 notes](releases/0.1.9.md). The new companion still requires runtime reload and actual upload, autosave and reopen acceptance. Earlier tool denials on extension management and internal extension pages remain in force, as does the unresolved automation file-upload permission. No final publication has been performed.

Historical 0.1.9 deployment: Obsidian's native plugin settings showed 0.1.9 enabled; the newly opened workbench loaded all three note images. Its title and complete Markdown matched the pre-update UI snapshot, and data.json remained byte-identical. Browser assistant 0.3.2 files match the bundled archive; its running version is not yet verified.

## Xiaohongshu first-image regression (0.1.8)

The current platform image node is an atomic block with `attrs.imgs`, not the standard Tiptap Image extension's `attrs.src`. Two new three-image regressions reproduced the exact placement failure in 0.3.0, then passed with 0.3.1, including repeated CDN URLs and retention of upload metadata after a document JSON round trip. Public platform script inspection establishes the schema contract, not successful execution of the complete companion in the live account. The attempted synthetic native upload was blocked because Chrome's automation extension lacks file URL access. See [0.1.8 notes](releases/0.1.8.md).

## Historical 0.1.4 checks

The following observations apply to the earlier build and are retained as historical evidence, not as fresh 0.1.9 acceptance.

`npm run verify` runs the official Obsidian ESLint recommended rules with zero warnings, conservative Chrome 120 CSS compatibility checks, TypeScript, 80 offline tests and a production bundle build. `npm run package` validates and packages the three plugin files.

Regression coverage includes rendering and sanitization, templates, network and redirect protections, image cache/order/retry/completeness, title/body copying, separate media delivery, draft retention across workspace modes, collapsed-drawer visibility, native DOCX XML/media relationships, relative font sizes, compiled plugin host behavior, settings, note enumeration and write-only clipboard access.

Browser checks used the current Studio source with an isolated local host and synthetic content. At 600 px the editor measured 560 × 360 px in a 780 px tall pane. 380/600/1100 px panes showed no horizontal overflow. Editing, preview and wide comparison modes, the template drawer, and the image export options were exercised. A five-card export produced 1080 × 1440 PNGs; all five were visually inspected. A 3,680-character unbroken paragraph plus a final image and end marker paginated to 15 cards without dropping the final content.

The Word export was created through the actual Studio export action using PNG and WebP source images. The DOCX embeds two native media parts, keeps body text and images in source order, and excludes the generated article title. Its two pages were rendered with the bundled LibreOffice renderer using a task-local fontconfig file for Chinese fonts and visually inspected. XML tests additionally cover repeated images, tables, links, invalid images and dark-template readability on white pages.

The 0.1.4 clipboard changes were checked against the current six-theme Shanhai generator: it writes rich HTML first, falling back to a native selection; its per-image flow converts decoded pixels to PNG. The current Shanhai output uses data URLs, without an upload step.

The actual Studio copy buttons were exercised in an isolated local Chrome page with synthetic PNG/WebP images. Browser automation uses a virtual clipboard bridge: paste events received `text/html` plus `text/plain`, two embedded images in order, no generated title and no copy controls, for both WeChat and Xiaohongshu modes. The per-image action delivered a 45,448-byte PNG file (960 × 400); copying a text-and-image card delivered a 114,095-byte PNG (1080 × 1440), visually inspected. This verifies browser API payloads and local paste handling, not the native macOS pasteboard or destination upload. Native selection fallback, failure cleanup, no silent plain-text downgrade and cursor restoration have offline DOM tests. A 380 px pane retained all copy controls without horizontal overflow.

These checks do not assert destination acceptance. Browser policy prevented access to the WeChat editor; no platform import/upload or publication was performed. Native Obsidian was observed running the 0.1.3 workspace before this update. Installed file verification and release provenance do not imply that the running plugin has been reloaded. Preserve/export temporary drafts before reloading.

Private notes, vault paths, local screenshots and machine logs are excluded from source control. Release assets are restricted to `main.js`, `manifest.json`, `styles.css`, with attestations from the tagged release workflow. Community review remains external.
