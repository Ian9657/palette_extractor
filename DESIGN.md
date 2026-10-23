# DESIGN.md

The design rules for Palette Extractor. **Read this before changing anything visual.** When a request conflicts with this file, say so instead of silently picking one; when the owner decides, update this file in the same change.

Owner: Ian9657. Design lead: Claude. Implementation may be done by Claude or Codex. The owner relays between them.

---

## 1. What this is

A photo goes in; it is **catalogued like an object in a magazine's register**: five-ish colours chosen by saliency, coverage and diversity, given roles, measured against each other, proofed and filed.

The page should let people *feel* harmony and opposition between colours — **without telling them what to feel**. No headings like "Harmony" or "Opposition"; only factual records, numbers and specimens. Meaning is discovered, never labelled.

Identity in one line: **a strictly typeset register, viewed through a night-city instrument.** The structure is a magazine; the screen-side objects carry the cyberpunk.

## 2. Two editions, nothing else

| Edition | Files | Status |
| --- | --- | --- |
| **Classic** (built April 2026) | `classic.html`, `style.css`, `color-classic.js` | **Frozen.** Do not change its look or algorithm. Bug fixes in shared `main.js` are allowed only if they don't alter classic's appearance. |
| **New** (homepage) | `index.html`, `edition.css/js`, `register.css/js`, `previews.js`, `cover.js`, `follow.js`, `fx.js`, `pagefx.js`, `color.js` | The one living design. |

- The new edition has **one appearance**: the dark night-city register below. **No day/night switch, no second theme.** Remove theme branches rather than leaving dead ones (`[data-theme="day"]` rules, `editionCopy.day`, `setEdition`, the pre-paint theme script).
- `prototypes/` is history. Don't edit; don't link from the live page.

## 3. Principles (in priority order)

1. **The extracted colours are the protagonist.** Interface colour must never compete with data colour. If a screenshot makes you wonder "is that swatch data or decoration?", the interface is too loud.
2. **Structure is strict.** One 12-column grid; everything aligns to it. Tidy magazine typesetting — never collage, tape, stamps, tilted elements or scattered labels.
3. **Paper is calm, screens carry signal.** At rest the sheet has no glow, no grid pattern, no animated texture. Digital texture (scanlines, RGB split, decoding text, glow) lives on screen-side objects: the Fig. 1 lens, the scan line, floating previews. The only exception is an **event**: a section's first scroll-in, a new palette, a pressed control may mark the paper for ≤ 350 ms (§7, `pagefx.js`), then it is calm again.
4. **Motion is sharp, not soft.** Effects the owner rated 9+/10 are frame-skipped and short: decoding text, RGB split, stepped openings, a single registration shift. Slow drifting, floating parallax and soft halos were rated as redundant (3/10). Prefer `steps()` timing and ≤ 350 ms.
5. **Facts, not slogans.** Every word on the page is a record: numbers, names, dates, states. No mood copy ("KEEP MOVING"), no fake system chatter.
6. **Less, then less again.** Before adding an element, find one to remove. Each new element must answer: what record does it carry?

## 4. Grid and spacing

- Sheet max width 1200 px. Shared 12-column grid (`--cols`, `--gutter: 1.5rem`).
- Every row (masthead line, entries, colophon): **columns 1–3 = margin** (numeral, label, caption), **4–12 = body**.
- Intake body is a 9-column subgrid: figure 5, record 4.
- Spacing scale only: `--s1 .5rem · --s2 1rem · --s3 1.5rem · --s4 2rem · --s6 3rem · --s8 4rem`. No ad-hoc margins.
- Below 760 px the grid collapses to one column with the same rules. No horizontal page scroll at 390 px.

## 5. Type

- **Three families, three jobs:**
  - **Chakra Petch** (`--font-display`) — nameplate, headings, section numerals, panel titles, role names. Its chamfered corners are the page's cyberpunk voice in type.
  - **Space Grotesk** (`--font-text`) — body copy: standfirst, specimen sentences.
  - **IBM Plex Mono** — labels, numbers, captions, data readouts.
- No serif, no italic, no fourth font, no pixel/Japanese decorative type. Classic keeps Space Grotesk throughout.
- Scale tokens only: `--fs-display` (nameplate only), `--fs-title` (opener headline, entry numerals), `--fs-heading` (panel h2), `--fs-body`, `--fs-label` (12 px), `--fs-micro` (10 px, the floor).
- Mono labels: uppercase, letter-spacing 0.08–0.14em. Numbers: `font-variant-numeric: tabular-nums`.

## 6. Colour

### 6.1 Interface tokens (the only interface colours)

| Token | Value | Job | Rules |
| --- | --- | --- | --- |
| `--desk` | `#080D18` | space around the sheet | — |
| `--bg-color` | `#111927` | the sheet (blue-black) | — |
| `--surface` | `#1A2333` | quiet secondary fills | — |
| `--text-color` / `--border-color` | `#F5F0E8` | ink: text and structure lines | — |
| `--hairline` | `rgba(245,240,232,.18)` | 1 px dividers | — |
| `--signal` / `--signal-ink` | `#00E5FF` | **the system at work**: entry numerals, FIG. labels, off-register nameplate plate, registration marks, lens brackets, scan line | the only accent used for marks and small text |
| `--alert` + `--alert-ink` | `#F0EF00` on `#191C23` | **look here**: small state tags (FILED, AWAITING DEPOSIT), the lens readout and crosshair | always a tag with ink text; never text colour; never a large area |
| `--danger` | `#FF4655` | errors only | never decorative |

- **Three accents, three jobs. Nothing else.** No pink/magenta, no second signal ("counter-signal"), no amber, no gradients as decoration.
- Glow (`drop-shadow` of `--signal`) only on screen-side objects (§3.3), max 4–5 px, never on the sheet or its frame.
- Contrast: small text ≥ 4.5:1 on the sheet; large marks ≥ 3:1.

### 6.2 Data colours

- Extracted colours appear **exactly as extracted** wherever they are data: COLOR BAR, matrix, CVD strips, specimen strip, plate stack, proof, archive, cover. Themes never recolour, filter or blend them (no `mix-blend-mode` on data on the dark sheet).
- The opener's headline rule shows `theme.primary` — that is data, and the only data colour allowed in the masthead/opener chrome.

## 7. Motion and effects catalogue

All effects respect `prefers-reduced-motion: reduce` (off or instant) and are desktop-pointer only where they follow the cursor.

| Effect | Where | Spec |
| --- | --- | --- |
| Scan development | Fig. 1 while k-means runs | signal line sweeps down over MAX_ITER × FRAME_MS; above it the clustered twin |
| Registration shift | Fig. 1, once when an object is filed | `FX.split`, ~320 ms |
| Lens | Fig. 1 after filing | negative-glass `backdrop-filter`, signal brackets that snap (lock) on role change, yellow crosshair + readout `ROLE · #HEX · X0000 Y0000` showing the **true** colour; follows pointer (delay `mid`), drifts when idle |
| Decoded text | lens readout, preview captions | `FX.decode`, 220–320 ms, only when the value changes meaningfully |
| Floating previews | archive (source thumbnail), matrix (type specimen) | `follow.js` delays `slow 12 / mid 7`; stepped opening `steps(6)`; scanlines inside |
| Title card | each entry, the first time it scrolls in | numeral decodes + `FX.split`; the panel h2 is cut in on an `--alert` card with `--alert-ink` text: wipe 3 steps, hold, wipe off 3 steps, 340 ms, once per page load |
| Sandevistan | COLOR BAR, when a new palette lands (deposit, COLORS, reroll, archive, hand edit) | the bar steps in from the left 12 px per 40 ms frame, leaving one solid afterimage per frame in the palette's own colours (most vivid first, max 4); then they drop out farthest first. Data colours exact, no filter on the swatches |
| Fringe | the control that was pressed (`.btn-export`, COLORS label) | `FX.split`, 200 ms. Never on data colours |
| Plate stack | under the sheet | one plate per extracted colour, exposed right/bottom; each plate eases on its own, front 0.585 → back 0.39; always z-below the sheet |

Adding a new effect requires: which screen-side object it belongs to, its duration, and what record it reveals. Effects without a record are cut.

## 8. Page anatomy (new edition)

1. **Masthead** — mono line (VOL. 01 — edition name · ISSUE nnn · date), nameplate PALETTE with one off-register `--signal` plate, EXTRACTOR + "A REGISTER OF COLOUR", the page's **only** heavy double rule. The edition name appears once.
2. **01 Intake** — Fig. 1 (4:3 drop zone; controls COLORS/REROLL directly under it) + opener: kicker, primary-colour rule, headline = primary colour's name, factual standfirst, accession record (folded until an object exists).
3. **02 Specimen** — COLOR BAR; actions: STAR, SAVE IMG, EXPORT ▾ (link, CSS, Tailwind, Figma). OKLCH line under each swatch.
4. **03 Relations** — contrast matrix (WCAG/APCA) with type-specimen hover; CVD strips in two columns.
5. **04 Proof** — the deposited photo re-rendered as one anime cel in the palette's inks (`proof.js`), in five production layers (colour, shadow, tone, line, composite). Static; EJECT / INSTALL / drag separate the layers in steps. Archive and favourites follow, folded.
6. **Colophon** — fonts, method, link to classic.

Section names must be consistent: a label used in the margin is not repeated as the panel's h2.

## 9. Rejected — do not reintroduce

- Day/night switch and any second theme for the new edition.
- Pink/magenta (any role), acid green, amber accents, "counter-signal".
- Whole-sheet grid pattern, whole-sheet glow, soft halos on the frame.
- Outer-frame experiments: chamfered corners with bezels, trim marks, slug rails, holographic parallax layers, depth rails, extruded/faceted slabs (kept in `git stash`, all rejected).
- Decorative text outside the content: vertical rails, mood phrases, fake HUD chatter, Japanese decorative type.
- Serif or italic type ("花体"); a fourth typeface.
- Hand-made collage props: tape, staples, rubber stamps, scissor cuts, tilted cards.
- Labelling meaning ("Harmony", "Opposition" rooms).
- Glitching the whole page or glitching continuously.

## 10. Working agreement (for every agent)

1. **Read this file first.** Quote the section you rely on when you make a judgement call.
2. **Work on a branch**, commit in small steps, **never push**. The owner pushes after review.
3. Commit messages: imperative subject ≤ 60 chars, a short body on *why*. **No `Co-Authored-By` or other attribution trailers** — the owner is the sole contributor.
4. One agent edits at a time. Don't touch files outside the task.
5. Before handing back: `node --test test/color.test.js` passes; the page loads with no console errors at 1400 px and 390 px; no horizontal scroll at 390 px; real pointer clicks hit their targets (check `elementFromPoint`, not just DOM state).
6. Hand-back note: what changed, which files, how it was verified, anything left open.
7. Changing the algorithm in `color.js`: run the 15-image comparison against `color-classic.js` (salient recall, max chroma, mean error) and report it. Don't make any image clearly worse.

## 11. Review checklist (used to accept a change)

- [ ] Data colours are the most saturated thing on screen; interface uses only §6.1 tokens in their jobs.
- [ ] Nothing glows, moves or textures on the paper at rest; event effects follow §7.
- [ ] Everything sits on the grid; spacing uses tokens; type uses scale tokens.
- [ ] No new words that aren't records.
- [ ] Motion is short, stepped, and tied to an event or a screen object.
- [ ] Classic unchanged (`git diff --stat` shows no classic files).
- [ ] No dead code left from removed options.
- [ ] §10.5 checks pass.
