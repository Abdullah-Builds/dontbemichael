# Don't Be Michael: Design System (v2, Studio)

This is the single design spec for everything that carries the Don't Be Michael name:
the desktop app (this repo) and the marketing site, dontbemichael.com
(`agentvivekkumar/dontbemichael_website`). It is canonical. It lives in `branding/`
with every logo, icon, color file and font, so the folder can be handed to anyone,
with or without the code. The repo-root `DESIGN.md` and the site's `DESIGN.md` only
point here.

**How to use it**

1. Every rule is tagged with the surface it binds: **[Both]**, **[App]** or **[Web]**.
   An untagged rule inside a tagged chapter inherits the chapter's tag.
2. Change the spec first, then the code. A design change that lands in code without
   a matching edit here is drift, and drift is a bug.
3. Where the code and this doc disagree and nobody has decided which is right, the
   gap goes in the §17 register instead of being quietly "fixed" in either direction.
4. Tokens are the contract. If a value you need is not a token, add the token here
   and in the token files (§14). Do not paste a hex value into a component.

**Version.** v2 "Studio", adopted 2026-09-30. It replaces the v1 pixel system
(`archive/DESIGN-v1-pixel.md`). As of adoption, **neither the app nor the site has been
migrated**: both still render v1. The migration is tracked in §17. Until an item there is
closed, the code is behind the spec, not the other way round.

**Reference screens.** The v2 screens are in [`reference/studio/`](./reference/studio/)
(§20), shot from the app's own components. When this text and a reference screen disagree,
this text wins.

---

## 1. Brand [Both]

### 1.1 The idea

Michael is the boss who kept every job on his own desk and called it leadership.
Don't Be Michael is the office he should have run: a team of AI agents that does the
work, while the owner signs off on it. Every design decision reinforces one of two
things. Either **the work is delegated**, or **you stay in control**.

v2 makes the first one visible. The home screen is an office you can watch: work comes in
through mailboxes, goes to Michael, and he hands it to whoever's job it is. Only what
Michael can't settle comes to you.

### 1.2 Why v2

The app grew out of Munder Difflin, and v1 kept its shape: a pixel office floor in
the middle, a strip of agent cards along the bottom, a Command Center on the right, and
pixel type and arcade color throughout. People read v1 as a copy. v2 keeps what is
ours (the name, the Struck M, Michael, the cast, the delegation idea, the business
features) and replaces everything that was shared: the floor, the layout, the pixel UI
and the arcade palette.

### 1.3 One system, two scales

The app and the site use **the same tokens**: the same colors, fonts, radii and studio
illustration. The difference is scale, not volume.

| | App | Web |
|---|---|---|
| Job | A workspace people sit in all day | A page that has to earn attention in seconds |
| Scale | Dense: 12 to 13 px UI text, compact cards | Large: 18 px body, 56 to 64 px headlines, full width studio art |
| Attention comes from | The coral Needs you signal and live motion on the stage | Headline size and the studio illustration |

There is no louder web palette. A hue means the same thing everywhere: coral means
"needs you", green means "done" or "on", blue means "working".

### 1.4 The mark: Struck M

The mark is unchanged from v1. It is the one pixel element in the brand, kept on
purpose as a signature.

A pixel capital M with a coral slash through it. Read it as "don't be M".

**Construction.** 16 × 16 cell grid. Origin top-left, `x` right, `y` down.

- Stems: columns 2, 3, 12 and 13, rows 3 to 13.
- Diagonals, each two cells thick: (4,3) (4,4) (5,4) (5,5) (6,5) (6,6) (7,6) (7,7),
  mirrored across x = 7.5 for the right side.
- Slash: every cell with `x + y ∈ {15, 16}` for `1 ≤ x ≤ 14`, drawn over the M with no
  knockout gap.

**Colors.** The mark does not follow the theme.

| Use | M | Slash | Ground |
|---|---|---|---|
| On light | `#1A1320` | `#FF6B6B` | transparent or `#F7F7FB` |
| On dark | `#ECEAF4` | `#FF6B6B` | transparent or `#14131C` |

The slash is always `#FF6B6B`, which is the logo coral, not the UI coral (§3.2). The mark
is a logo, not UI.

**Size and space**

- Render only at integer multiples of 16 px, or as SVG with `shape-rendering:
  crispEdges`. Never blur, anti-alias or resample it at a fraction. Minimum 16 px.
- Clear space is 2 cells (1/8 of the mark's width) on every side.
- In the app top bar the mark is 26 px, drawn as SVG (the one allowed non-multiple,
  because it is vector and crisp-edged).

**Don't**

- Don't rotate, outline, add a shadow to, or recolor the mark.
- Don't redraw the slash as a smooth line. It is pixels.
- Don't put the mark on coral or on a busy image.
- Don't use pixel art anywhere else in the brand. The mark is the only one.

### 1.5 Wordmark

`Don't Be Michael` in **Sora SemiBold (600)**, sentence case with the apostrophe,
letter-spacing `-0.02em`, all in ink. Coral appears only in the mark's slash.

- Beside the mark, the wordmark's cap height is 55 to 60% of the mark's height, and the
  gap is 10 px at 26 px mark size (scale proportionally).
- In the app the lockup sits at the left of the top bar (§7.1). On the web it is the nav
  logo.
- The lockup files in `logo/lockup/` are outlined, so no font is needed.

### 1.6 App icon [App]

Unchanged: the Struck M on a tile. Canvas 1024 × 1024, tile inset 100 px (824 × 824),
macOS continuous corner radius 185 px, tile fill `#FFFDF5` with a 2 px inner line
`#1A1320` at 12% opacity, mark at 512 × 512 centered. Windows `.ico` and Linux PNGs use
the square tile with no radius. Favicons and the Apple touch icon use the same `#FFFDF5`
ground.

### 1.7 Name, cast, parody and legal lines

- The product name is **Don't Be Michael**. Always with the apostrophe.
- The team members use *The Office* character names (Michael, Pam, Kelly, Dwight, Oscar
  and the rest). Names only: never NBC or show logos, title lettering, cast photos,
  likenesses or show quotes presented as official material.
- Office humor lives in words (names, empty states, the idle quote bubbles in §8.8),
  never in chrome, and never on anything the owner has to act on.

---

## 2. Principles [Both]

1. **Delegation is the picture.** The main view shows work arriving, going through
   Michael, and landing with the right person. If a screen hides who is doing what, it
   is wrong.
2. **Calm by default. Coral only for you.** Everything is quiet pastel except the things
   that need the owner. If coral appears, the owner has something to do.
3. **Every state has words.** Status is never color or motion alone. A pod that glows
   also has a pill that says "Working".
4. **Only what's real.** The UI shows what the app actually does. No switch, chip or
   button for a capability that isn't enforced. (The mockup era learned this: web
   switches and "spending asks you" chips were removed because nothing enforced them.)
5. **Art carries information.** The studio illustration is a status display, not
   decoration. Lit screens, glows, beacons and tokens all mean something (§8).
6. **Fields first.** Screens show fields, values and actions. Explanations go behind a
   small (i) info icon, in short text.
7. **Modern and flat, with depth only where it explains.** Soft shadows lift cards off
   the stage; the isometric studio gives the office a place. No skeuomorphism beyond that.

**Not:** pixel UI or pixel type (the mark excepted), arcade saturation, hard offset
shadows, chunky frames, glassmorphism as a style (Michael's glass pod is illustration,
not UI), gradients as decoration (the exceptions are listed in §3.8), dense tables as a
home screen, an email client look.

---

## 3. Color

All values below are the contract. Each token has a light and a dark value; the site is
light only (§15).

### 3.1 Neutrals [Both]

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F7F7FB` | `#14131C` | App and page ground, stage ground |
| `floor` | `#E9E7F7` | `#26223B` | Studio platform floor, subtle fills |
| `card` | `#FFFFFF` | `#1F1E2B` | Cards, panels, inputs, popovers |
| `card-2` | `#FAFAFD` | `#24233A` | Inset rows inside a card (stats strip, input fill) |
| `rail` | `#F8F7FC` | `#181722` | Right column ground (§3.8 allows a 2 stop gradient `#FBFBFE` to `#F6F5FB` in light) |
| `chrome` | `#F1F0F8` | `#1B1A26` | macOS title bar strip, top bar ground under 70% white |
| `ink` | `#1E1B2E` | `#ECEAF4` | Primary text, primary buttons (light), icons |
| `ink-2` | `#4A4660` | `#CFCCDD` | Secondary text, captions, tab labels |
| `ink-3` | `#6C6884` | `#A5A2B8` | Tertiary text: meta, placeholders, hints, legends |
| `ink-4` | `#B4B1C6` | `#8C89A0` | **Non-text only**: disabled icons, info icon ring, decorative dots |
| `line` | `#E8E6F2` | `rgba(255,255,255,.09)` | Card borders, dividers (decorative) |
| `line-2` | `#DAD7EA` | `rgba(255,255,255,.14)` | Stronger dividers, secondary button border |
| `line-input` | `#8F8AA6` | `#76728C` | Boundaries that identify a control (input, textarea, select, switch track off). 3:1 or better |
| `neutral-soft` | `#F0EFF5` | `#2A2938` | Idle pill fill, quiet chips |

Never `#000` or `#FFF` for text in dark mode. White text on dark fills is `#FFFFFF`
only on `ink` buttons in light mode.

### 3.2 Semantic accents [Both]

Each accent has three roles: the **base** (dots, strokes, icons, fills without text),
**soft** (a tinted fill behind text), and **text** (text on white or on its own soft).

| Hue | Meaning | Base light | Soft light | Text light | Base dark | Soft dark | Text dark |
|---|---|---|---|---|---|---|---|
| `coral` | Needs you. Only the owner's to-dos | `#FF5A5F` | `#FFECEC` | `#C8303A` | `#FF5A5F` | `rgba(255,90,95,.16)` | `#FF8C90` |
| `green` | Done, on, live, good | `#1FB872` | `#E3F7EC` | `#157D4D` | `#34CD8A` | `rgba(52,205,138,.14)` | `#34CD8A` |
| `blue` | Working | `#4C6FFF` | `#E8EDFF` | `#3553E8` | `#8FA3FF` | `rgba(124,147,255,.16)` | `#8FA3FF` |
| `violet` | Thinking, a question between teammates | `#8B5CF6` | `#F0EAFE` | `#7043E6` | `#B69CFF` | `rgba(167,139,250,.17)` | `#B69CFF` |
| `amber` | Sticky notes, a proposal, a loop warning | `#F2A93B` | `#FFF4DF` | `#8F5C07` | `#F2B45A` | `rgba(242,180,90,.15)` | `#F2B45A` |
| `indigo` | Michael, links, focus, requests | `#6C5CE7` | `#EEEBFD` | `#4338CA` | `#9D90FF` | `rgba(157,144,255,.16)` | `#A99FFF` |

**Coral fills that carry text** (the Needs you button, count badges, a coral primary
button) use `coral-strong` `#D4363D` in light mode (4.78:1 with white). In dark mode they
keep `#FF5A5F` and use `ink-on-coral` `#14131C` text (6.0:1). Plain `#FF5A5F` with white
text measures 3.05:1 and is not allowed for text under 18.66 px bold.

Rules:

- Coral is reserved. No decorative coral, no coral CTA on the website, no coral for
  errors that the owner doesn't have to act on (use `ink-2` with an icon).
- A new accent needs all six columns at once, or none.
- The logo coral `#FF6B6B` (§1.4) is not a UI token.

### 3.3 Message acts [Both]

Work moving between people is drawn as tokens on paths (§8.6). Their color comes from the
hive message act:

| Act | Token | Color | Glyph |
|---|---|---|---|
| `request` | `act-request` | light `#5B55C9`, dark `#8F89F2` | envelope |
| `query` | `act-question` | `violet` base | `?` |
| `propose` | `act-propose` | `amber` base | envelope with a dot |
| `inform` | `act-inform` | `ink-4` | envelope, outline only |
| `agree`, `done` | `act-done` | `green` base | check |
| `refuse` | `act-refuse` | `ink-2` | envelope with a slash |
| `needsHuman` (escalated to the owner) | `act-you` | `coral` base | `!` |

Only `act-you` tokens travel from Michael to the right column. A team member never sends
one directly: they go to Michael first (§8.6).

### 3.4 Departments [Both]

Pods, avatars and illustration faces use a pastel family per department. Each family has
`l` (lightest face), `m` (main face), `d` (shaded face) and `acc` (glow, the tint of a
working glass monitor, department icon and plate, tag rule).

**Avatars.** A person is drawn as their character's signature prop on a circle of their
department's `l` (the light `l` in dark theme too, with an `m` edge), so a prop reads the
same in both themes: Michael's World's Best Boss mug (on ink in both themes), Pam's
palette, Erin's balloon, Dwight's beet, Jim's tuna can, Stanley's pretzel, Phyllis's
knitting, Andy's banjo, Ryan's rocket, Oscar's calculator, Angela's cat, Kevin's chili
pot, Toby's island palm, Kelly's phone, Nick's router, Sadiq's lock, Creed's sprout,
Meredith's party hat, Darryl's music note (owner, 2026-10-03: the letter added nothing),
and Pete's magnifier over a globe for the Research member, its own face that no hire takes
(owner, third ship D4).
Someone with no known character keeps their initial. One component draws them all
(`PersonAvatar`, `scene/office/props.tsx`).

**Department icons.** One line icon per job function, stroked in `acc`: front desk tray,
support headset, sales trend arrow, finance coins, marketing megaphone, people pair, IT
monitor with code, operations box, team sparkle. They sit in the department tab (§7.14).

| Department | Roles today | `l` | `m` | `d` | `acc` |
|---|---|---|---|---|---|
| `front-desk` | Executive Admin | `#FFE4EC` | `#F7C3D2` | `#EBA6BA` | `#E25A83` |
| `support` | Customer Support | `#DDEEFF` | `#B4D5F8` | `#93BEEE` | `#3D8BE6` |
| `sales` | Sales Director | `#FFF3CC` | `#F8DF95` | `#EDCB6E` | `#D29B0B` |
| `finance` | Finance | `#D8F5E8` | `#AEE6CD` | `#8DD5B5` | `#1FA872` |
| `marketing` | Marketing | `#FFE6D8` | `#F9C8AE` | `#EEB090` | `#E57B45` |
| `people` | HR Manager | `#EFE6FC` | `#D6C5F4` | `#C1AAEA` | `#8A63E0` |
| `it` | IT Engineer, IT Security | `#E0E6F7` | `#BAC5E8` | `#9DABDA` | `#5468C4` |
| `operations` | Supply Chain, Inventory & Shipping, Quality Control | `#D5F3F4` | `#A9E3E5` | `#86D2D5` | `#169BA3` |
| `team` | A new job written in the hire wizard | `#EDEBF6` | `#D8D5EA` | `#C4C0DE` | `#6C6884` |
| `manager` | Michael | glass (§8.4) | | | `#6C5CE7` |

**Dark derivation.** In dark mode each family is derived from its `m` value in HLS:
`l` = L .36 S .34, `m` = L .28 S .30, `d` = L .22 S .28, `acc` = L .70 S .80 of `acc`.
Monitors are glass in both themes (§8.3): a working screen takes `acc`, with a softer halo
in the dark.

The role to department mapping is data, not art: it lives next to `OFFICE_ROLES`
(`src/shared/officeRoles.ts`) when the app migrates (§17).

### 3.5 Status [App]

Status reads from the owner's side. Every status has a pill with a word (§7.13) and a pod
treatment (§8.5).

| Status (store) | Pill label | Pill colors | Pod treatment |
|---|---|---|---|
| `working` | Working | `blue` text on `blue` soft | Glass screen tinted in `acc` with scrolling lines (§8.3), floor glow in `acc` |
| `thinking` | Thinking | `violet` text on soft | Three dot bubble over the monitor |
| `waiting` (at a prompt, not busy) | Waiting | `ink-3` on `neutral-soft` | Screen on, no glow |
| `blocked` on the owner | Needs you | white on `coral-strong` | Coral beacon above the pod, pulsing |
| `compacting` | Tidying up | `violet` text on soft | Small box glyph on the desk |
| `looping` | Stuck | `amber` text on soft | Amber ring around the chair, rotating |
| `success` | Done | `green` text on soft | Check burst, then back to idle |
| `idle` | Idle | `ink-3` on `neutral-soft` | Pod desaturated (saturate .25, opacity .82) |
| on hold (1:1 with the owner) | 1:1 with you | `indigo` text on soft | Headset glyph; no tokens arrive from Michael |
| draft in the terminal | typing dot | `indigo` base dot | none |

Separate from status: a **for you** badge (§7.15) counts the Ask me cards tagged to that
person. A person can be Working and still have "1 for you".

### 3.6 Logo colors

`#1A1320` (M on light), `#ECEAF4` (M on dark), `#FF6B6B` (slash). Fixed. See §1.4.

### 3.7 Shadows as color

| Token | Light | Dark |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(30,27,46,.05)` | `0 1px 2px rgba(0,0,0,.35)` |
| `shadow-md` | `shadow-sm, 0 6px 18px rgba(62,52,140,.08)` | `shadow-sm, 0 8px 22px rgba(0,0,0,.32)` |
| `shadow-lg` | `shadow-sm, 0 10px 30px rgba(62,52,140,.10)` | `shadow-sm, 0 12px 32px rgba(0,0,0,.40)` |
| `shadow-hub` | `shadow-sm, 0 10px 26px rgba(92,76,220,.14)` | `shadow-sm, 0 10px 26px rgba(0,0,0,.45)` |
| `shadow-coral` | `0 4px 14px rgba(212,54,61,.30)` | `0 4px 14px rgba(255,90,95,.25)` |
| `ring-select` | `0 0 0 3px rgba(30,27,46,.08)` | `0 0 0 3px rgba(236,234,244,.12)` |

### 3.8 Gradients [Both]

Allowed only here: the stage's radial light (white at 0 to transparent at 70%, 900 × 520
ellipse at the stage center), the rail's two stop vertical gradient, the context meter
fill (`#8E83F5` to `#6C5CE7`), glass and glow in the studio illustration (§8), and the
web hero's backdrop (the same radial light). Nowhere else.

---

## 4. Typography

### 4.1 Faces [Both]

| Face | Role | Source |
|---|---|---|
| **Sora** (400, 500, 600, 700) | All UI and display text, the wordmark | Google Fonts, OFL. `fonts/sora/` |
| **IBM Plex Mono** (400, 500, 600) | Numbers, times, counts, ids, email addresses, file paths, schedule "when" lines | Google Fonts, OFL. `fonts/ibmplexmono/` |
| **JetBrains Mono** | The live terminal only (xterm), for its box drawing and ligature-free metrics | Bundled today. `fonts/jetbrainsmono/` |

Fallbacks: Sora → `system-ui, -apple-system, "Segoe UI", sans-serif`; for Simplified
Chinese add `"PingFang SC", "Noto Sans SC"`; for Arabic add `"SF Arabic", "Noto Sans
Arabic"` (Sora has Latin only). Mono → `ui-monospace, "SF Mono", monospace`.

Retired: Press Start 2P, VT323, Pixelify Sans, Inter. They left the kit and the app on
2026-10-01 (§17).

Rules:

- Numbers that the owner scans or compares (counts, times, money, ids) are mono.
- Sora tracking: `-0.03em` at 20 px and up, `-0.02em` at 15 to 19 px, `-0.01em` at 12 to
  14 px, `0` below 12 px. Mono is always `0`.
- Uppercase is only for micro labels (department tabs, field labels, eyebrows) with
  `+0.05em` to `+0.08em` tracking. Never uppercase a sentence.
- Weights: 400 body, 500 labels and tabs, 600 names, titles and buttons, 700 only for
  avatar initials (someone with no character, §3.4).

### 4.2 App scale [App]

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `t-view` | 20 / 26 | 600 | View title on the stage ("Office", "Tasks") |
| `t-panel` | 15 / 20 | 600 | Right column heading, person name in the panel header |
| `t-ui` | 13 / 18 | 400 to 600 | Base UI: tabs, buttons, inputs, body |
| `t-read` | 14 / 22 | 400 | Long text boxes in a wide panel only (what a person handles, their work style), and the wide 1:1's questions and replies (§7.19) |
| `t-body` | 12 / 16.5 | 400 | Card body text, Michael's questions, descriptions |
| `t-meta` | 11 / 15 | 400 to 600 | Captions, chips, meta lines, hints |
| `t-micro` | 10 / 13 | 600 | Uppercase micro labels, status pills, badges |

Floor: nothing below 10 px, and 10 px only for uppercase micro labels, pills and
badges.

### 4.3 Web scale [Web]

| Token | Desktop | Phone (≤ 480 px) | Weight | Use |
|---|---|---|---|---|
| `w-display` | 64 / 68 | 40 / 44 | 600 | Hero headline |
| `w-h2` | 40 / 46 | 30 / 36 | 600 | Section headline |
| `w-h3` | 22 / 30 | 20 / 28 | 600 | Feature titles, card titles |
| `w-lead` | 20 / 30 | 18 / 28 | 400 | Hero and section sublines |
| `w-body` | 17 / 27 | 16 / 25 | 400 | Body text |
| `w-small` | 14 / 20 | 14 / 20 | 400 to 500 | Captions, footer |
| `w-eyebrow` | 12 / 16 mono | 12 / 16 | 600 | Uppercase eyebrow, `+0.08em` |

---

## 5. Spacing and layout

### 5.1 Grid [Both]

4 px base. Spacing tokens: `s-1` 4, `s-2` 8, `s-3` 12, `s-4` 16, `s-5` 20, `s-6` 24,
`s-8` 32, `s-10` 40, `s-12` 48, `s-16` 64, `s-24` 96. Odd values in the reference
screens (7, 9, 11, 13 px) snap to the nearest token in the build.

### 5.2 App shell [App]

One window, four regions. Nothing else is permanent.

```
+---------------------------------------------------------------+
| macOS title bar (28, hiddenInset)                             |
| Top bar (56): lockup, view tabs, clock, version, icons, Needs  |
+---------------------------------------------+-----------------+
| Stage (fills)                               | Right column    |
|   Office / Tasks / Who talks to whom        | (420, resizable)|
|                                             |                 |
| Bottom bar (50, floats 24 above the edge)   |                 |
+---------------------------------------------+-----------------+
```

| Region | Size | Holds |
|---|---|---|
| Top bar | 56 px, ground `chrome` under `card` at 70% | §7.1 |
| Stage | Fills | The current view (§7.2): Office (studio, §8), Tasks (§7.20), Pulse (§7.27), Who talks to whom (§7.22) |
| Right column | 420 px default, 320 min, 1200 max and never closer than 360 px to the window's left edge, drag to resize (SidebarSplitter, double click resets to 420; its grip shows only on hover); a person's or Michael's panel can also open wide in the center (§7.6) | Closed by default: while nothing waits and nobody is open the column is not there and the office takes the window (`bleed` 0, no splitter). Otherwise the Needs you board, the selected person's panel or Michael's panel (§7.6). Work tab widens it to 480. It has no ground of its own (owner, 2026-09-30: a panel behind cards is a layer too many): the Needs you heading and cards, and the person and Michael panels (cards themselves), sit straight on the stage, which runs on underneath (`StudioStage` `bleed`); the scene still fits the space left of it |
| Bottom bar | 50 px tall, floats 24 px left, 22 px right and 26 px above the stage's bottom edge | Talk to Michael composer, next job chip and Hire (§7.19) |

Rules:

- **No bottom strip of agent cards, no left floor, no permanent Command Center.** People
  live on the stage.
- Minimum window 1280 × 800: the studio scales down to fit the stage beside a 320 px
  right column. Below 1100 px of stage width the platform scales, never crops.
- Focus mode (full screen terminal) keeps its v1 behavior with v2 styling. Hidden in this
  build (`SHOW_FOCUS_MODE`, owner, 2026-10-01): no button opens it and a saved preference
  does not reopen it.
- RTL: the right column moves to the left, bars mirror, the studio art does not (§8.10).

### 5.3 Web layout [Web]

- Container 1200 px max, 24 px gutters, 16 px under 480 px.
- Section rhythm: 96 px between sections on desktop, 64 px on phone.
- Check at 1440, 1040, 980, 480, 390 and 320 px.
- The hero is two columns on desktop (text left, studio right, studio bleeds to the
  container edge) and stacked on phone (text, then studio at full width).

---

## 6. Surfaces, borders, shadow, radius [Both]

### 6.1 Surfaces

- Cards: `card` fill, 1 px `line` border, `shadow-md`. Nested rows use `card-2`.
- Elevated cards (Michael's hub card, the Talk to Michael composer, overlays): `shadow-lg`
  or `shadow-hub`.
- Selected card: 1 px `ink` border plus `ring-select`.
- Overlay backdrop: `bg` at 60% with no blur (light), `#000` at 45% (dark).
- Label cards on the stage use `card` at 96% opacity with a 6 px backdrop blur, so the
  studio reads through slightly. Idle ones at 86%.

### 6.2 Radius

| Token | Value | Use |
|---|---|---|
| `r-xs` | 3 px | Sticky note corner accents, tiny marks |
| `r-sm` | 6 px | Department tabs, tags, small icon buttons |
| `r-md` | 9 px | Buttons, inputs, view tabs, textareas |
| `r-lg` | 12 px | Chips, bottom bar chips, menus |
| `r-xl` | 14 px | Cards, Ask me cards, label cards |
| `r-2xl` | 16 px | Composer, hub card, overlays |
| `r-pill` | 999 px | Pills, badges, clock, Needs you button |

The v1 "no radius" rule is retired.

### 6.3 Borders

Hairlines only: 1 px. The exceptions are the 2.5 px top rule on mailbox tags (§7.18) and
the 1.5 px coral ring and 700 title and
button of the Danger zone card in Settings, General, which is loud on purpose because
Reset deletes the office (owner, 2026-10-02). Edit agent's Danger zone (§7.26) is the one
other card with that coral tint and ring, because Delete removes a team member for good
(owner, 2026-10-14; blessed at ship review, 2026-10-16).

---

## 7. App components [App]

Names in parentheses are today's components that the v2 component replaces or restyles.

### 7.1 Top bar

Left to right: lockup (§1.5, 26 px mark); view tabs (§7.2); then, pushed right: clock
pill (§7.3), version chip (§7.4), Beta pill (lemon-light, 10 px caps, with an InfoTip that opens toward the start), icon buttons (theme, Settings; focus mode hidden in this build, `SHOW_FOCUS_MODE`; 32 × 32,
`r-md`, `ink-2` icons, hover fills `card` with a `line` border), and the Needs you button
(§7.5). The bar is a drag region; interactive children are `no-drag`. The Beta pill is its
own layer (240) above the stage, the right column and the bottom bar, so its tip is never
drawn under the Tasks board; focus mode, toasts and dialogs stay above it. The bar itself
has no layer, so the update badge's cards keep competing at 400.

### 7.2 View tabs (TopBar)

Office, Tasks, Pulse (§7.27), Who talks to whom, then any **file tabs** (docs/designs/open-file-tab.md).
Tab: `t-ui` 500, `ink-2`, padding 7 × 13, `r-md`.
Active: `ink` fill, white text (dark mode: `ink` fill `#ECEAF4`, text `#14131C`). No tab
carries a count: the Needs you button (§7.5) is the one coral number, what is waiting on
the owner. A blocked count on Tasks beside it read as the same thing with a different
number (owner, 2026-10-01); blocked work shows in the board's Blocked column and on
Michael's wall. The choice persists (`cth.floorView`).

File tabs: a file opened from a chip (§7.8) that the office can show (Markdown, text,
JSON, CSV, TSV, images; PDF and Office files open in their own app) gets a tab after a
1 × 18 px `line-2` hairline: a 14 px icon, the name (ellipsis at 160 px, full path as
tooltip) and a 22 px close ✕ (its own button, "Close {name}"). One tab per file, keyed by
its real path; opening it again selects it; at most 5, a sixth closes the one opened
longest ago. They shrink to fit (down to about 72 px), and the fixed tabs, the clock and
Needs you never move. Never saved: the app restarts on the last fixed view. Closing the
selected tab selects the file tab to its left, or the view the owner came from. The right
column stays beside a file tab, so an Ask me card is answered while its file is read. A
file tab has no bottom bar (owner, 2026-10-16); it stays mounted, hidden, as on Pulse.

The file view: a `card` header with the name (14 / 600), its place in office words
("Office / IT", or a team member's name and folder; `ink-3`, full path as tooltip), and
`sm` secondary "Open in app" (not for JSON) and "Show in Finder". Body: Markdown as a
document, text and JSON in mono 12 / 18 wrapped, CSV and TSV as a table (sticky header,
the first 1,000 rows, then "Showing 1,000 of N rows"), images fitted to the width.
States in `ink-3`: "Reading…", "Not found" (no actions), "Empty file", "Too large to show
here" or "Can't show this file here" with Open in app (Show in Finder for JSON). The view
re-reads the file within a second of a change while shown, keeping the scroll.

### 7.3 Clock pill

Pill, `card` fill, `line` border, padding 6 × 12. Green live dot (7 px with a 3 px
`green` soft halo), mono time in `ink` 600, "Office open" in `ink-2`, a chevron. While the
office opens (§7.24) the dot is `indigo` with the slow pulse and the words are "Opening" and
a mono "5 of 12" (no count before any team exists), on every view; it goes back to "Office
open" when everyone is in or at the one minute cap (design review 1A, 2026-10-18). Click
opens a menu: **Office schedule** (opens Michael's Office schedule tab), **Closing time**
(starts the closing time flow). Office hours are not a setting in the app (packs carry
`officeHours`, which only starter jobs and the Tasks view's "hasn't moved this" read), so the
pill never shows a closing time; the reference
screens' "closes 6:00 PM" is sample copy (§17).

### 7.4 Version chip (UpdateBadge, CliUpdateBadge)

Mono 11 px, `card` fill, `line` border, `r-sm`, a 6 px dot: `blue` when current, `green`
with "Update ready" when a download is ready, `amber` with "Team upgrade ready" for a
Claude Code update. Click behaves as today's badges.

### 7.5 Needs you button

Pill, `coral-strong` fill, white `t-ui` 600 text, `shadow-coral`, padding 6 × 7 × 6 × 14.
A 7 px white dot that pulses (§11) and a white count bubble (mono 12 px 600, `coral-strong`
text). With zero waiting it becomes a quiet pill: `card` fill, `line` border, `ink-3`
text "Nothing needs you", no dot, and it is a plain label, not a button. While the count is
still unknown at launch it is the same quiet pill with no text, never a false "Nothing needs
you". The coral pill shows the Needs you board (never closes it, since a waiting ask keeps the
column open) and moves focus to the first card's reply field; a screen reader hears "Michael needs you: N" once each time
the count rises (docs/designs/needs-you-empty-state.md). With only Report cards waiting
(§7.8) it stays quiet: the same pill reads "Reports: N" in `ink-2` and is a button that
opens the board.

### 7.6 Right column

Four states, one region (docs/designs/needs-you-empty-state.md). The column shows on the
Office view only: Tasks, Pulse (§7.27) and Who talks to whom take the whole window (owner,
2026-10-03). It
stays mounted there, hidden, so a person's terminal and a half written reply survive the
switch; anything that opens it (the Needs you pill, a "?" or "for you" badge, a person, the
next job chip) goes back to the Office first.

0. **Closed**. Only when nothing at all waits on the owner: not rendered, the office fills
   the window. While any Ask me card or schedule request waits the column is open (the
   board, or a person's panel with the coral strip) and cannot be closed: an ask arriving
   opens the board, at launch too (owner, 2026-10-02). Focus moves only on the owner's
   click (the pill, a "for you" chip). Opening and
   closing slide the column over 240 ms while the office eases to its new size with a
   transform (no per frame layout); reduced motion snaps.
1. **Needs you board**. Heading "Needs you" (`t-panel`), a count bubble, an info icon,
   and a close ✕ at its end only when nothing waits. Cards stack newest first (§7.8, §7.9) with 12 px gaps,
   straight on the stage (the column has no ground of its own, §5.2). After the last
   answer it reads "All clear." (`t-panel`) with one Office humor line (13 px, `ink-3`)
   and the answered card, and closes on the next click outside it, Esc, or a pod.
   Esc closes the column only with focus inside it and nothing waiting; a reply holding
   text is left first.
2. **Person panel** when a pod is selected (§7.10 to §7.12).
3. **Michael's panel** when Michael's pod is selected (§7.12).

In states 2 and 3 a compact coral strip sits at the top: "Needs you N" with a chevron,
`coral` soft fill, `coral` text, `r-lg`. It returns to the board. With nothing waiting
the strip is hidden.

A "Bring back last session's team" card (restore all, dismiss one) floats over the
office's top left corner (top right in RTL), `card`, `r-xl`, `shadow-lg`, when there is a
team to restore. It never opens the column or counts toward Needs you.

Closing a person's or Michael's panel returns to the board while anything waits, and
collapses the column when nothing does.

**Wide panel** (design review 2026-10-16). A button beside close on a person's and
Michael's panel, and in Edit agent's header (`expand`, then `minimize`; tooltip and label
"Open wide" / "Back to the side"), moves the panel to the center of the window: 10% in
from each side, 12 px under the top bar and above the bottom edge, at every window size.
The choice is remembered on this computer and applies to every panel that can open wide;
it is never set by the window's size. The Needs you board and Ask me cards never go wide.
The column keeps its slot, so the office does not reflow, and dims under the top bar
(`--cth-backdrop`), so the coral pill stays bright and live; only one thing holds the center,
whichever the owner opened last, this or the wide 1:1 (§7.19), the other back to the side for now
(the Needs you board and a panel at the side sit beside the wide 1:1 instead); the office and the bottom bar
are out of reach (inert) and a click on the dimming does nothing. Inside, text is at most
720 px across and centered; the Work tab's terminal fills the panel. Edit agent lays over
the wide panel in two columns: the short fields (300 to 360 px) and the work style (up
to 720 px), titled "Edit {name}" with a 28 px avatar and the role, long boxes in `t-read`.
Leaving Edit with unsaved changes, by any way out (close, Cancel, Esc, the pill or strip,
another person, a menu item), asks "Discard changes to {name}?" with Keep editing as the
default. Esc: a field with text is left first, then the panel goes back to the side, then
the column closes. The move takes 320 ms (`dur-slow`, transform only), the dimming fades
in over 200 ms; reduced motion switches at once. In Arabic it mirrors.

### 7.6a Office stops (OfficeBreakNotice)

When Claude cannot work, the office says why on one card at the top of Needs you
and in a chip in the top bar that opens Needs you. Nothing types into a Claude
terminal until it is back; schedules run as configured and their jobs wait in
the inboxes. One state, three reasons (docs/designs/office-stopped-account.md):

| Reason | When | Look | Card |
|---|---|---|---|
| Plan limit | The Claude plan reached its usage limit | Quiet: `amber` soft card and chip, not counted. It ends on its own. | "The office is on a break", then when work starts again |
| Out of credit | The Anthropic account has no credit (`billing_error`) | An owner to do: a plain Ask me card (§7.8, no side rule), counted in the Needs you button; `coral` chip "Office stopped" | "Your Anthropic account is out of credit." Primary Add credit (the `external` icon, spoken "opens in your browser") opens the Anthropic billing page; secondary Try again |
| Sign in | The login expired, or the API key stopped working (`authentication_failed`) | As out of credit | Account: "Your Claude account needs you to sign in again." with Sign in. API key: "The Anthropic API key stopped working." with Change key. Both open the Get Michael ready rows. |

Title "The office stopped" (the plan limit keeps "The office is on a break"),
one reason line (`role="status"`), then the buttons; the explanation is behind
the info icon. The card sits first in Needs you. While a sign in stop is on, the
Get Michael ready card (§7.25) is not shown, so one problem is one card.

States after the owner acts: Checking (the buttons go; a small spinner and
"Checking that work can start"), Still out ("Still out of credit. Credit can
take a few minutes to show." with the buttons back), Done (the card and chip
go). Out of credit and an expired account login also check on their own every
15 minutes; a key that stopped working waits for Change key. Resuming only sends
the next message: nothing restarts, except the Claude terminals after a new key.

### 7.6b Not reporting (SilentEngineCards)

A team member whose AI engine stopped reporting to the app (issue #326; design review
2026-10-16; approved picture `silent-engine-v2.html`). Its reports are how the app follows
its work and checks its folders and tools, so the owner hears, plainly, and can act in one
click. A plain Ask me card (§7.8: no side rule, no "from" line) at the top of Needs you,
under an Office stops card when one shows, counted in the Needs you button.

- **Words.** Title "{name} isn't reporting to the app"; one line "{name} is still working.
  The app can't check {name}'s folder and tool limits."; a time line in `t-meta` `ink-3`
  ("Last checked in {n} min ago." or "Hasn't checked in since {name} started, {n} min
  ago."). Why it matters is behind the info icon. Names only, never he or she, in every
  language.
- **One card per engine, version and kind** (never checked in, or went quiet mid work);
  Research has a card of its own. Members silenced together ("Kelly, Dwight and Oscar
  aren't reporting to the app") share one card and one count; a member who reports again
  drops off the list.
- **States.** Not reporting (Restart {name}); Restarting or Checking (a spinner, no
  buttons); a restart didn't help, or the version is known never to report: the engine and
  version named, with Change engine (opens Edit {name}, the engine open) and Keep working
  unchecked; Paused, where nothing else guards the files (Windows, Gemini anywhere, and
  Research): Restart and Keep working unchecked, or Change engine and Keep working unchecked
  after a failed restart; Done closes it with "{name} is reporting again". Research's card
  offers Restart only: it is never kept working unchecked (owner, 2026-10-17).
- **Michael.** When Michael isn't reporting, the office's own card, built like The office
  stopped (§7.6a) with an "The office" kicker, sits first: "Michael is still working, but
  can't pass on mail or work right now." with Restart Michael. Never restarted on its own.
- **Elsewhere.** An amber `Not reporting` tag (`amber-soft`, `amber-text`) replaces the
  member's status pill on its pod and panel header; one amber line above the panel's tabs
  ("The app can't see {name}'s work right now. The Work tab still shows it live."), or,
  when the owner kept it working unchecked, "{name} works unchecked on {engine}, by your
  choice." with Check again. One desktop notice in Michael's name when a card first
  appears, only with notifications on.

### 7.7 Buttons

| Kind | Fill | Text | Border | Use |
|---|---|---|---|---|
| Primary | `ink` | white | none | The main action in a card or dialog ("Reply", "Approve", "Save", "Send") |
| Secondary | `card` | `ink` | 1 px `line-2` | Other actions ("Decline", "Open Mailboxes", "Hire", "Edit") |
| Quiet | none | `ink-2` | none | Tertiary links in a row ("Earlier answers", "change") |
| Coral | `coral-strong` | white | none | Only the Needs you button, and Reset & start over inside the Danger zone card (owner, 2026-10-02). Never a general CTA |

Height 28 px in cards, 32 px in bars, 36 px in the composer and dialogs. `t-meta` 600 at
28, `t-ui` 600 above. Radius `r-md`. Focus per §12. Disabled: 45% opacity, no shadow.

### 7.8 Ask me card (AskMeTab)

The owner's only inbox. Michael raises a card only when he could not re-delegate or
unblock the work himself.

Owner, 2026-09-30: a plain card, and a board you can scan. No side rule, no "From Michael"
(only he raises these), no "saved to memory" note (the answer is still saved to the
person's memory and routed to whoever asked), no underlined titles. The cards sit straight
on the stage, 12 px apart, each with a `line` ring and a soft two layer shadow so it
stands on its own.

- Title: a few plain words naming the matter, under 60 characters. Agents are told to
  write it that way (no ids, dates, mailbox names or bracketed notes), and the card cleans
  any that still arrive (`askTitle`: opaque ids and trailing bracketed metadata go; owner,
  2026-10-01: a header full of a user id and "(support@, 1 Oct)" read as cryptic).
- Folded (every card but one): the task title (`t-ui` 600 at 13, `ink`, `indigo` on hover),
  the person it is for as a 22 px chip in their department colors, how long ago Michael
  asked ("just now", "5h ago"), a "Draft" tag if an answer is half written, and the ask
  itself in at most two lines (`askHeadline`: his bold first sentence, as plain text, in
  `ink-2`). The whole header is one target; Enter and Space open it. On the right, a 14 px
  chevron (`ink-3`, darker on hover) that points down while folded and turns up when the
  card opens. There is no dismiss (owner, 2026-10-01): an ask is cleared only by answering
  it, including "done" when the owner handled it.
- Open (one at a time; the newest until the owner picks another, `line-2` ring and
  `shadow-md`): the same header, then Michael's full question as markdown at 12.5 / 18 in
  `ink`; one row with the answer (one line that grows with the text up to 160 px, about
  eight lines, then scrolls; owner, 2026-10-01: a longer answer was hard to write;
  placeholder "Your answer, or done if you handled it") and a primary "Reply"; "Holding up N tasks" folded under it; and
  a footer with "See full context" (the ask's full background and history; owner,
  2026-10-01: it is context, not a task) and "N earlier answers". The footer shows only
  when the card holds more than the question: a background, a result, or other
  questions and answers (owner, 2026-10-12: it opened to a repeat of the question). Cmd or Ctrl+Enter sends; Enter
  respects IME composition.
- Options and several questions (owner, 2026-10-15; `docs/designs/ask-me-options.md`).
  An ask whose entry carries `options` is a choice; one with `parts` is several questions,
  each maybe with its own `options`. Anything the app can't read shows the plain card
  above. Picking never sends: the box is full width under the options, and Reply sits
  on its own row, end aligned, 8 px below it, its label following the pick ("Reply with
  option 1", "Reply with option 1 and note", "Reply to 2 of 5"). Nothing starts picked.
  - Option row (a radio group): `card` fill, 1 px `line-2` ring, `r-md`, padding 8 × 10,
    gap 9; a 16 px radio dot (1.5 px `line-input` ring); the option number at 11 / 600
    `ink-3`, then the label at 12.5 / 18 `ink` as card markdown. Rows 6 px apart, 10 px
    above the box. Hover: `card-2` fill, `line-input` ring. Picked: `indigo-soft` fill,
    1.5 px `indigo` ring, dot filled `indigo` (8 px). Focus: 2 px `indigo` ring. Arrows
    move and pick, Space picks, clicking the picked row unpicks it.
  - Recommended tag: pill, `green-soft` fill, `green-text`, 10.5 / 600, 18 px tall, at
    the row's end. Text "Recommended".
  - Question line: the number at 11 / 600 `ink-3` in a 20 px column, end aligned; the
    question at 12.5 / 18; a part's options as choice chips (26 px pill, `card` fill,
    1 px `line-2` ring, 11.5 px `ink`, 5 px apart; pressed like a picked row, the
    Recommended tag inside at 16 px and 10 px); then its field, `.cth-input` at 30 px.
    Parts 10 px apart. Any part may be left blank; Reply settles the whole ask and the
    blank ones go to the team member through Michael.
  - Placeholders: "Or write your own answer", "Add a note (optional)" once an option is
    picked, and "Anything else (optional)" under several questions.
- "Holding up N tasks", when tasks wait on the answer, opens to their titles in `ink-2`
  (a status dot each, up to 6, then "+N more").
- Files the question names (owner, 2026-10-04 and 2026-10-10; `docs/designs/open-file-tab.md`)
  are chips in place of their path, inside the text: a code span with a known file
  ending, a full path in plain text (`/`, `~/`, a drive letter), or a Markdown link to a
  full path. A code span that names a file without its ending becomes a chip only when a file
  of that name is found in the office's folders (owner, 2026-10-19); otherwise it stays text.
  Chip: `neutral-soft` fill, `r-sm`, 24 px tall, padding 0 8, gap 6; a 14 px
  `file`, `sheet` or `image` icon in `ink-3`; the file name without folder or extension
  (12 / 500 `ink`, ellipsis at 200 px, the full path as its tooltip); then the action in
  `indigo-text` 600: "Open" for a file the office can show (it opens as a file tab, §7.2)
  or a document inside the office folders (its own app), "Show in Finder" ("Show in
  folder" on Windows and Linux) for anything else. The whole chip is one button
  with this action. Right-clicking it opens a small context menu with that same
  action and "Copy path", which copies the checked full path through the app's
  clipboard bridge. The menu uses `card`, `line`, `r-lg`, `shadow-lg` and
  `neutral-soft` for hover, opens outside clipping cards, and stays inside the
  window. While the chip has focus, Shift+F10 or the context menu key opens the
  menu. There is no separate visible actions button. Keyboard users can choose
  an action and dismiss the menu with Escape; focus returns to the chip. Copy
  shows "Copied" only after success, or a short
  retry message on failure. Loading and Not found chips have no actions. Hover
  `indigo-soft`, focus ring 2 px `indigo`. The action cell is as wide as its longer label
  from the start, so nothing jumps when the check lands; if the check fails it offers
  Show in Finder. A file that is gone, or outside every office folder, is a chip with no
  fill, a `line` ring, all `ink-3` and "Not found": text, not a button. Folded cards show
  nothing. Task detail and Michael's replies (§7.19) use the same chips.
- Links in agent text (owner, 2026-10-11; `docs/designs/named-links.md`) are named, on
  every card-mode surface (Ask me, Michael's replies, Task detail, memory notes, Work
  styles, profile); file tabs and the IDE show links as written. A pasted URL shows the
  app it opens ("HubSpot", "QuickBooks", "Google Sheets"), else the site without `www.`,
  or the address for email; a link the agent wrote as words keeps them. The link is
  `indigo-text` 500, underline 1 px at 2 px offset (2 px on hover), then a 12 px
  `external` icon (`mail` for email) 3 px after it, glued to the last word; the full
  URL is its tooltip; focus ring 2 px `indigo`, 2 px offset. Hidden after the name for
  screen readers: "opens in your browser" or "opens your email app". When the words
  name a known app or a web address the link does not go to, the real site follows in
  `ink-3`: "HubSpot (hubspot-login.example)". Hosts are what the browser reaches
  (lowercase, punycode for a look-alike letter).
- Optional secondary actions Michael attached (for a broken mailbox: "Open Mailboxes").
- **Mail approval cards** (MailProposalCards, docs/designs/send-on-approval.md): "{name}
  wants to send an email" with the avatar; From, To and Cc as `t-meta` lines; editable
  Subject and Message fields (`.cth-input`); one quiet line when it forwards an email or
  attaches files from other emails; the agent's offer as an unticked "From now on, send
  emails like this without asking" checkbox when it made one, whose kind becomes an
  editable field once ticked; buttons Don't send, Ask for changes (a
  required note) and Approve (primary).
- **Report cards** (docs/designs/michael-replies.md, 14A): a scheduled outcome, such as
  the weekly money summary, is a card with a "Report" tag (`neutral-soft`, `ink-2`) after
  the questions. Same frame, file rows and reply; a secondary "Got it" clears it and sends
  Michael nothing. Reports never turn the Needs you pill coral or hold the column open:
  with only reports waiting the quiet pill reads "Reports: N" and opens the board.
- **Research card** (issue #230, once, updated offices only): the same Report card, "Your team no
  longer uses the internet", "This keeps your private data in. One team member, Pete, can look
  things up for them, after a privacy check. Pete is off until you turn them on.", Got it and Open
  Research & privacy (primary, opens Settings on Research & privacy); either clears it for good.

### 7.9 Schedule request card (ScheduleRequestCards)

Same card frame as §7.8. Title row plain (not a link): the requester avatar plus "Dwight
asks to change a schedule". A definition list with uppercase micro labels (`t-micro`,
`ink-3`, 64 px column): ADD / CHANGE / PAUSE / DELETE, WHY, MICHAEL (his note). Actions
right aligned: secondary "Decline", primary "Approve". When the request is stale, Approve
is disabled and a `t-meta` line explains it. This is the only card type with Approve and
Decline.

### 7.10 Person panel header

- 44 px avatar (their prop, §3.4), name `t-panel`, role `t-meta`
  `ink-3`, status pill (§7.13), caption with a dot (`t-meta`, `ink-2`).
- Right: "Edit" secondary button with a pencil (opens EditAgentModal), close `x` (secondary,
  32 × 32).
- Private note row: `amber` soft fill, `r-md`, note icon, "Note:" 600 plus the first line,
  pencil to edit.
- The cleared conversation banner (ClearedBanner) sits under the note when present.

### 7.11 Panel tabs (SidebarTabs)

Underline tabs: `t-ui` 500 `ink-3`, active `ink` 600 with a 2 px `ink` underline, 16 px
gaps, a 1 px `line` rule under the row. Arrow keys, Home and End move focus; RTL mirrors.
When the labels overflow a narrow panel the row scrolls sideways with no scrollbar: the
mouse wheel moves it, and each edge with tabs hidden past it fades out over 28 px.

- Person: **Profile, Access, Messages, Memory, Work**. Traces, Git and IDE stay behind
  their build flags and append after Work when on.
- Michael: **Profile, Access, Work, Office schedule, Memory, Advanced**, plus **History**
  after Office schedule only once a webhook exists. Ask me is not a tab; it is the board.
- The chosen tab is shared across people, as today.

### 7.12 Tab contents

**Access** (CapabilitiesTab). Grouped rows in cards (`card`, `line`, `r-xl`). Only what is
enforced today:

| Group | Controls |
|---|---|
| Email | No switch (owner, 2026-10-07): the header chip says "Mailboxes: N" or "None". One row per address the member uses (mono address, Remove): an **Inbox** line, green dot "{name} watches it" or grey dot "{holder} watches it. {name} sends only." ("Nobody watches it. {name} sends only." when no one does), and a **Sending** segmented control [Can send, Send on approval, Draft only] with the meanings behind an info icon. Under the watched inbox: "Also sends from here: ..." (`ink-3`); removing it while others send from it asks first and names them. Under each row: "Sends without asking" (standing approvals, each with Revoke) and, for Send only, "Sent from here lately" (up to five). A paused Send only row shows an `amber-soft` note. **Add a mailbox** (link) opens a `card-2` panel: a mailbox select, then radio rows [Watch the inbox, Send only]; a choice that can't be made is greyed with its reason, never hidden; Add and Cancel (`docs/designs/shared-mailboxes.md`) |
| Claude connectors | One row and switch per connector the owner turned on in Settings, A to Z; "2 of 4" in the header. QuickBooks keeps radio rows [Read only, Can make changes] under its row, and an `ink-3` "on for bookkeeping roles" while the role default holds. None on: one `ink-3` line with a link to Settings. A pending restart shows under the groups with Restart now (`docs/designs/claude-connectors.md`) |
| Files | Read only row: lock icon, "Own folder only", the folder name, "Open folder" link |
| On a schedule | "+ Add" link. Rows (owner, 2026-10-01, three quiet lines): switch; the job name (14 px) with the next run on the right; the when line (14 px, `ink-2`); then the status line (last run, and who added it only when it was not the owner) in `t-meta` `ink-3` |

The group list is data driven: a new enforced capability adds a group. Nothing appears
before it is enforced (§2.4).

**Work** (terminal). A row: eye icon plus "Watching" and a live dot; zoom (minus, 100%,
plus) as a segmented group ("Focus" only when focus mode is on, `SHOW_FOCUS_MODE`). Then the terminal pane: `#1B1A28` fill in
both themes, `r-lg`, JetBrains Mono 12 px, padding 14. Locked input line at the bottom:
lock icon plus "Locked while Michael runs Kelly. Talk 1:1 to type." Under the pane:
secondary "Message Michael about Kelly", primary "Talk 1:1", hint "Michael sends Kelly no
work during a 1:1". In a 1:1 the input unlocks and the message queue composer (attach,
queue, send now) replaces the two buttons, with "End 1:1".

**Office schedule** (Michael, read only). No office hours line: office hours are not a
setting (§7.3). Groups by person: avatar plus name, "Edit on Access" link with a chevron. Rows:
job name, mono when line, right aligned "next" label (`t-micro`) over a mono time. Paused
jobs show a muted switch and "Paused".

**Profile, Messages, Memory, Advanced** keep today's content (§17 lists them for
restyle): Profile's does and asks first lists, key facts and Open folder; Messages'
day grouped threads; Memory's notes by kind, procedures and search; Advanced's monitor,
dispatch, model and engine, archived list and activity log.

### 7.13 Status pill

`t-micro` 600, padding 2 × 7, `r-pill`, a 5 px dot in `currentColor` before the word.
Colors per §3.5.

### 7.14 Pod label card

The card floating by each pod on the stage.

- `r-xl`, padding 12 × 10 × 0 × 9, `card` at 96%, `line` border, `shadow-md`.
- Department tab on the top edge, offset −9 px: the department icon (§3.4, 10 px, `acc`)
  and uppercase `t-micro` in a `card` chip with an `m` border and `r-sm`. Beside it: the sticky count (§7.16) and the for you badge
  (§7.15). The pod itself also names the department, on its plate in front of the chairs
  (§8.3), so a pod showing only its quiet chip (§7.14a) still says what it does.
- Row: 24 px avatar, name (12.5 → `t-ui` 600), role (`t-micro` 400 `ink-3`, not
  uppercase), status pill top right.
- Caption: `t-meta`, `ink-2`, one line, ellipsis. The live action, else the first words of
  the last prompt, else the next scheduled job.
- A second person in the same pod: a dashed `line-2` divider, then the same row and
  caption. Up to four people per card (§8.9).
- Idle: card at 86%, name and caption in `ink-3`.
- Selected: `ink` border plus `ring-select`. Everything else on the stage dims to 45%.
- Click selects the person. Tab and arrow keys move between cards (§12).
- Height: 66 px for one person, 78 px more for each other person (`CARD_ROW_H`). A card
  above its pod keeps its size while the stage scales, so on a short window the stage moves
  down, or shrinks, until that card's tab clears the top edge by 18 px.

### 7.14a Quiet pod chip

A pod where nobody is at work (every member idle or waiting) shows a chip on the pod
instead of its label card, so an idle office stays calm (owner, 2026-09-30).

- A 28 px pill: `card` at 92% with a 6 px blur, `line` ring, `shadow-sm`; the members'
  20 px avatars overlapping by 6 px, their names in `t-meta` 600 `ink-2`, and the For you
  badge (§7.15) when anything waits on the owner.
- Sits just over the pod's monitors, for every slot (owner, 2026-10-01: hung under the
  right and front pods, Oscar's and IT's chips floated on empty floor); no stem.
- While anyone in the pod is thinking, working, blocked, compacting or looping, the chip
  gives way to the full card (§7.14) at the pod's card slot, with its stem.
- Hovering the chip, selecting someone in the pod, or a lab spotlight opens the full card
  in the chip's place instead (owner, 2026-10-01: it used to open at its slot, away from
  the chip, and then both showed the same names and badges). The chip hides; the card's tab
  row (department, sticky count, For you) lands where the chip was, and the card rolls down
  from there (240 ms, a clip from the top with a 6 px drop), centered on the pod and
  allowed to cover its monitors. A 24 px invisible margin keeps it open while the pointer
  crosses the chip's old spot; it closes 220 ms after the pointer leaves. No browser tooltip on the chip. Clicking the
  chip opens the first member's panel.
- An idle line belongs to the chip: its speech bubble's tail points at the speaker's
  avatar there (§8.8).
- Demo mode (`quietCards`, the studio lab only, §8.13): every pod shows its chip even
  while people work; a card opens on hover or for a moment when the lab spotlights someone.

### 7.15 For you badge

Pill, `coral` soft fill, 1 px `#FFC7C9` border (dark: `coral` at 35%), `coral` text
`#C8303A` (dark `#FF8C90`), `t-micro` 600, a 5 px `coral` dot, "1 for you". Shown only
when an Ask me card is tagged to this person. It is a button: it opens the Needs you board at
the pod's newest ask with focus in its reply field; the rest of the pod still opens the panel.

### 7.16 Sticky count

17 px square, `#FFE58A` fill, `#6B5200` mono 10 px 600 text (5.9:1), rotated −5°, corner
radius 2 2 6 2, `shadow-sm` tinted amber. Count of tasks this person is doing. Click opens
the first task.

### 7.17 Michael's name plate and hub card

Michael's numbers live on his glass walls (§8.4; owner, 2026-09-30: a card always on screen
was a distraction). There is no chip: the name plate on his glass is the way in. Hovering
or focusing it opens the full hub card just under the plate and lights the plate's rim in
`indigo`; a click selects him, which keeps the card open.

The hub card: 212 px wide (so the five board labels never touch), `r-2xl`, `shadow-hub`.

- Top: 26 px avatar (Michael's mug on ink, §3.4), name, "Office Manager", status pill, caption.
- Stats strip (`card-2`): three columns, mono 16 px 600 numbers: **delegated** (today's
  hive messages from Michael with act `request`), **to you** (open Ask me cards), **kept**
  (tasks assigned to Michael himself). Labels `t-micro` 400 `ink-3`. "to you" in `coral`
  text when above zero.
- Task board strip: To do, Doing, Waiting, Blocked, Done, the Tasks view's columns and words,
  with 6 px square keys (`ink-4`, `blue`, `amber`, `coral`, `green`) and mono counts. Click
  opens Tasks.
- Context meter: label, 5 px bar with the indigo gradient (§3.8), mono percent.

### 7.18 Mailbox tag

Beside each mailbox post on the stage. 36 px tall, `card`, `line` border, `r-lg`,
`shadow-md`, a 2.5 px top rule in the owner's department `acc`. Mono address (11 px 600)
over the owner's name (`t-micro` 400 `ink-3`). Broken mailbox: coral soft fill, `#FFC7C9`
border, coral top rule, a second line "Password stopped working" in `coral` text 600, and
a small "Fix" coral pill that opens Settings, Connections, Mailboxes.

### 7.19 Bottom bar

- **Talk to Michael composer** (MessageQueueComposer for Michael; owner, 2026-09-30: "Brief
  Michael" was unclear): 400 px, 50 px tall,
  `card`, `line-2` border, `r-2xl`, `shadow-lg`. When Michael's conversation has saved history, a
  conversation button first (34 × 34, `neutral-soft`, `r-md`, a chevron: up to open, down while the
  dock is open, with an `ink` fill) opens or closes the dock. Attach button (34 × 34, `neutral-soft`,
  `r-md`), a message box with placeholder "Talk to Michael…", primary button "Send" with
  an arrow. The box grows with the text up to 140 px, then scrolls; the composer grows
  upward from the bar's bottom edge with its buttons on the bottom row, and the chips
  beside it stay put. Enter sends, Shift+Enter starts a new line (owner, 2026-10-01). It
  keeps at least 300 px, so the placeholder never wraps. A pasted screenshot or Finder files attach, as on Michael's Work tab. Focus rings the
  whole composer in `indigo`.
  A question to Michael opens the **conversation dock** above it
  (docs/designs/michael-replies.md): 400 px, up to 430 px tall (never taller than the room
  under the top bar), `card`, `r-2xl`, `line-2` ring, `shadow-lg`. Header: 26 px avatar,
  Michael's name, "N open" in `ink-3` with an info tip, close ✕. The owner's messages sit
  right in `neutral-soft` bubbles with one live status line under each (a 6 px dot plus
  words on §3.5 meanings: Sent and Waiting on X `ink-3`, Michael has it `blue`, Answered
  `green`, Later than he said `amber` with Nudge, Waiting for you `coral-text`, Couldn't
  finish `ink-2` with Ask again). Michael's replies sit left on `card` with a `line` ring,
  markdown at 12.5 / 18, first sentence bold. A longer reply is the answer first, then lists
  (markers `ink-3`), small tables or short paragraphs under bold labels (paragraphs 0.6em apart). Tables
  fill the bubble, rows split by a `line` rule, headers 11 px 600 `ink-3`, amount columns mono 12 px with
  tabular figures; a table too wide scrolls sideways in its own box, which takes Tab (focus ring `indigo`)
  and is labelled "Table". A long reply folds at 8 lines of height (notes 6) with a 24 px fade into the
  bubble, then More. Reply shows under Michael's question back and under his latest answer to an
  answered question. Files as §7.8 chips (notes too);
  terminal notes are muted (`card-2`, "From Michael's notes"); a refusal with no reason
  reads "No reason given". Bubble tails and the quote bar use logical corners and edges,
  so they mirror in Arabic. Empty: one line and two example chips. The dock slides 180 ms
  up from the composer and snaps under reduced motion. One count on the composer replaces
  the queue chip: mono 11 px on `indigo` (`on-indigo` text) for unread replies,
  `coral-strong` (`on-coral` text) while Michael waits on the owner. The dock
  opens only on the owner's action and closes on ✕, Esc, or a floor click with nothing
  typed. Opening follows the latest or navigates once to the requested question. While
  the owner reads earlier messages, arrivals preserve the visible passage, and so does a
  move between the bar and the center. A reserved 48 px footer holds a 32 px secondary
  button with `indigo` text, `card`, `line-2`, `r-md`, `t-body-sm` 600 and the downward
  arrow. It reads "N new replies" for new replies, or "Jump to latest" for notes; it is
  separate from the unread badge. The empty footer keeps its height without a border or
  fill. Clicking the button or scrolling to the bottom resumes following. Navigation is
  immediate, including under reduced motion. Arrivals never move keyboard focus; the
  button disappears once used, so it returns its focus to the message box. A known slash
  command still types straight into Michael's terminal.
  **Wide 1:1** (design review 2026-10-17): Open wide beside ✕ (the wide panel's button, §7.6)
  moves the conversation and the message box to the center, one card with the box at the bottom
  (its ring only, `indigo` on focus), the office dimmed and out of reach, the box's slot kept in
  the bar. It never covers the right column (owner, 2026-10-17: a question on Needs you may be what
  you ask Michael): with the column open it fills the office's width, 24 px from the office's
  edge and 12 px from the column, and the column stays bright and live; with the column closed it
  takes the wide panel's frame. Its own choice, remembered on this computer,
  changed only by that button. Text at most 720 px across, `t-read` 14 / 22, owner bubbles at
  most 560 px; nothing folds; tables as wide as their columns, 24 px apart, headers 12 px,
  amounts 13 px mono. Esc goes back to the side for now, a second Esc closes. The move is the
  wide panel's 320 ms transform; reduced motion switches at once. The box keeps its text, files
  and reply target and takes focus at the end of the text.
- **Next job chip**: calendar icon, "Next:" `ink-2`, mono time 600, job and person.
  `card`, `line`, `r-lg`, 40 px tall. Click opens Office schedule.
- **Hire**, pushed right: secondary "Hire" with a plus (opens the hire wizard). No pack
  caption beside it (owner, 2026-10-03: a bare caption among card chips looked orphaned);
  each job in the hire wizard carries its pack's name.

### 7.20 Tasks view (TasksKanban)

- Header on the stage: "Tasks" `t-view`, count chips (To do, Doing, Waiting, Blocked in
  coral soft, Done in green soft; each chip is clickable with `aria-pressed` to filter the
  board to that status, clicking again resets to all columns), right aligned lock icon plus
  "New work goes through Michael" (`t-meta`, `ink-3`). No add button; the board is read only.
- Find a card (issue 158): one row above the columns, a search field (`cth-input`, 30 px,
  up to 260 px, placeholder "Search tasks") matching title, description, result, id,
  waiting on, or the team member's name; a team member select ("Everyone", "Unassigned",
  or a specific member, `line-input` boundary, 30 px). While either is set, a quiet Clear
  (28 px target, `ink-2`) and a count indicator ("Showing X of Y tasks", mono count) follow
  them, each column counts only matching cards, and Done unfolds in full.
- Five columns on a `floor` tinted ground, `r-xl`, 16 px gaps: To do, Doing, Waiting
  (`amber` key, yellow), Blocked, Done. Column head: key dot, name `t-ui` 600, mono count. Blocked
  column tinted `coral` soft. An empty column shows "Nothing here", or "No tasks match your
  search or filters" when search or filters are active. A Waiting card shows an `amber` soft
  chip "Waiting on {who}" (card-lifecycle.md section 8).
- Order (owner, 2026-10-17): To do, Doing, Waiting and Blocked read earliest Next first; cards
  with no Next time come after the dated ones; at the same time the higher priority first, then
  the order made. A time already passed is earliest. Done reads newest first. Search and the
  member filter keep the same order.
- Time groups (owner, 2026-10-17): each open lane is cut by the card's Next time, in the
  viewer's local calendar, with a heading where the group changes (11.5 px 600 `ink-3`,
  Overdue in `coral-text`): Overdue, Today, Tomorrow, This month, This quarter (the rest of the
  current quarter; in October to December it reads Later this year), Next quarter, Later this
  year, Next year, Later (two years or more), No date. Groups run earliest to latest; an empty
  group shows no heading, and a lane with no dated card shows none at all. Done has no groups.
- Task card: `card`, `line`, `r-lg`, padding 12. Mono id (`#112`, `ink-3`), title `t-ui` 600
  up to 2 lines, assignee avatar plus name. Waiting on the owner: a 18 px coral "?"
  circle top right. Done: a small green check, text in `ink-2`. Hover shows the dismiss
  `x`: it closes the card as Done by the owner's decision and never deletes it
  (`docs/designs/card-lifecycle.md` section 4); such a card reads "Closed by owner". A card
  whose owner answer Michael has not closed reads "With Michael" and how long, then
  "Michael hasn't moved this" after one working day of office hours; a Blocked card with
  nothing asked reads "Nothing asked". Done shows the last 5 and "N more".

### 7.21 Task detail (TaskDetailOverlay)

Centered overlay over the stage (never over the right column), 528 px wide, `r-2xl`,
`shadow-lg`, backdrop per §6.1.

- Header: the mono id chip (one line, ellipsis) and close `x` on the first row; the title
  `t-panel` under them at full width, cleaned like an Ask me title (§7.8) (owner,
  2026-10-01: side by side, a long id squeezed the title).
- Four fields in a row with uppercase micro labels: STATUS (select, `coral` text when
  Blocked; it offers To do, Doing and Done (a Done card offers only To do: choosing it opens a full
  width row under the facts with a "Why reopen it?" `cth-input` box, primary Reopen and secondary
  Cancel, and the reason reaches Michael; card-lifecycle.md section 10), and shows Blocked or Waiting only as the card's
  current state, since only Michael sets them; a Waiting card reads "Waiting on {who}"
  under it, `amber` text), ASSIGNEE (person chip), PRIORITY (5 dots,
  filled `ink`), CREATED (mono).
- DESCRIPTION: the card's `description` when a request gave it one; no section otherwise.
  Cards carry no running notes (owner, 2026-10-11: agents used them as diaries; an agent's
  activity lives in its conversation and the office log). A To do card with a one off
  step at a set time shows "Next: Mon, 12 Oct, 8:00 AM" (`nextAt`, local time), on the
  card under the assignee and in the detail, with the year when it is not this year
  ("Next: Mon, 4 Jan 2027, 9:00 AM").
  QUESTIONS (the Q and A trail, newest first like Ask me, each question's top row saying
  how long ago it was asked, "5d ago", 11 px `ink-3` as on Ask me cards, nothing when the
  time is missing; an open question sits
  in a coral soft box with a "Waiting for you" pill; answered ones are plain), DEPENDENCIES
  (rows with a link icon, mono id, title, "waits on this").
- Footer: secondary "Assign" with the hint "Sends it to Michael to hand out"; secondary
  "Close" with an `Esc` key hint. Esc closes.

### 7.22 Who talks to whom (MemoryGraphPanel)

- Canvas on the stage: `floor` tinted, `r-2xl`, a 24 × 18 px dot grid at 55%.
- Toolbar card top left: title `t-panel`, a time range select (Last 1 hour, 4 hours,
  8 hours, 1 day, 3 days, 1 week, 2 weeks, 1 month; default Last 1 day, remembered on this
  computer) and a Refresh icon button. An empty range says so in the middle.
- Person nodes: avatar circles (Michael 72 px, others 48 px) showing the person's prop
  (§3.4), with a 3 px department `acc` ring and the name under them. A pinned node shows a small pin badge.
- Edges behind nodes: `ink-4` at 40% to 70%, 1 to 6 px wide by message count.
- Hovering an edge: the edge turns `violet` 3 px with a handle dot; non neighbors dim to
  30%; a tooltip card (`r-lg`, `shadow-lg`) shows both avatars, "Dwight and Oscar",
  "6 messages today" in `violet` text, and "Last: ..." with a mono time.
- Hovering a node shows its memory snippet instead (one card at a time). Drag pins a node.
  Click a person opens their Memory tab.
- Legend card bottom left: Person, Messages, and an info icon.
- Nodes stay clear of both cards: the layout keeps 44 px from every edge, plus 52 px under
  the toolbar and 56 px above the legend.

### 7.23 Menus, tooltips, info tips, toasts, dialogs

- Menus and popovers: `card`, `line`, `r-lg`, `shadow-lg`, 6 px padding, rows 32 px.
- What's new (Settings, General, About card) is the one popover in the tooltip style: `ink`
  fill, `bg` text, a caret to its link, `r-lg`, `shadow-lg`, title 13/600, body 13, links 12.
  White on the white card was hard to read (owner, 2026-10-02).
- Info tip: a 15 px circle, 1 px `ink-4` ring, "i" in `ink-3`. Hover or focus shows a
  tooltip: `ink` fill, white `t-meta`, `r-md`, max 260 px. (Dark: `#ECEAF4` fill, `#14131C`
  text.)
- Toasts (completion, update, Claude Code update): bottom right above the bottom bar,
  `card`, `line`, `r-xl`, `shadow-lg`, 360 px max, up to 4 stacked. Auto dismiss per today.
- Closing time is not a dialog (owner, 2026-09-30): quitting with people at work starts it
  at once, and a closing bar takes the bottom bar's place: `card`, `r-xl`, `shadow-lg`, the
  moon mark, "Closing time" and the counter strip ("5 / 8 workers confirmed"), a progress
  line, "3 still working" as a 24 px `indigo-soft` pill with a chevron (up to open, down while open)
  inside a 28 px target, opening the rows (Remind, Close without them; one scroller, 300 px), "Cancel and go back
  to work", and "Force quit now", which asks once because unsaved work is lost.
- A person who has gone home at closing time (confirmed, or closed without) is gone from the
  floor (owner, 2026-10-03; `docs/designs/closing-floor.md`): their desk goes dark and they
  leave the pod's chip and card; a pod with nobody left loses its chip, fading out with the
  lights over 1.4 s (none with reduced motion), and nothing on it opens anyone. They open
  from no view until closing is cancelled; a panel open on them closes (Needs you if anything
  waits) and focus goes to the closing bar. Their mailbox tag and post dim to 45%. Michael
  stays usable until closing completes. Cancel brings everything back at once.
- Dialogs (Settings, hire wizard, edit person, add mailbox; `shell/Dialog.tsx`): `card`,
  `r-2xl`, `shadow-lg`, title row with a close, an optional footer for the actions,
  backdrop per §6.1 (a drag that ends past the edge never closes it), `role=dialog`, focus
  trapped and restored, Esc closes only the top dialog and never from inside a field.
  Office folder missing is a launch screen, not a dialog: the lockup over one card.

### 7.24 Empty and starting states

- **Starting**: the office opens dark and the lights come up as people clock in (§8.12).
  A card over Michael's pod says so (owner, 2026-10-17; design review 2026-10-18, the owner
  found the white card easy to miss among the name chips). It is the one colored card on the
  floor: `indigo-soft` fill, a 1.5 px `indigo` ring plus `shadow-lg`, `r-xl`, padding 14 × 16,
  min(300 px, stage width less 32); the floor stays clickable under it
  (`components/OpeningCard.tsx`). Rows: the 12 px `indigo` dot with the slow pulse, "Clocking
  in" at `t-view` 600, the mono count ("5 of 12 in", `t-ui`, `ink-2`) at the end; a 4 px bar
  (`indigo` on `indigo` 20%, `role=progressbar`); "Still coming: Toby, Ryan, Oscar and 4 more"
  (`t-body`, `ink-2`, roster order). When the last person is in it turns `green-soft` with a
  `green` ring and a check, "Everyone's in", the full bar, for 2 s, then fades in 300 ms. If
  anyone is still out at the one minute cap it turns `amber-soft` with an `amber` ring and a
  still dot: "11 of 12 in" and "Toby hasn't clocked in." (or "Toby and 2 more haven't clocked
  in.") for 4 s, then fades; Needs you's not reporting card carries it from there when the app
  sees that engine running without reporting. The opening runs from launch, or a Restore team,
  until that first end (never before the automatic restore has had its chance), and then it is
  over for the session: a hire or Research turned on later clocks in on their own desk only,
  with no card and no pill change. Before any team member exists, Michael's own start uses the
  same card ("Michael is clocking in", no count, bar or names). A screen reader hears the
  opening once ("Office opening, 5 of 12 in") and its end once, never each count. The clock
  pill agrees (§7.3).
- **No team yet**: the platform with Michael's pod only, a centered card "Your office is
  empty" and a primary "Hire" button.
- **Needs you empty**: there is no empty board. With nothing waiting the column is closed
  (§7.6); the one line of Office humor lives in the board's "All clear." moment.
- **Office folder missing** and **GPU or render failure** keep their dedicated screens,
  restyled.

### 7.25 Onboarding (OnboardingWizard)

Full window, no app chrome.

- Header: lockup left; step indicator center: eight labelled steps (Business, Details,
  Meet, Team, Home, Manager, Permissions, Ready; seven when Michael's engine is not Claude) in a `card` pill container, each a 22 px circle
  (done: `green` with a check; current: `ink` with the number; next: `line-2` ring with the
  number) joined by 1 px `line-2` rules; "Step 4 of 8" right, `t-meta`.
- Body: a 560 px card with the step's fields. While the studio isn't showing (Business,
  Details, Resume, or no team yet) the card is centered under the step indicator; once it
  shows, the card sits at the start edge and the studio (§8) fills the rest, reacting to
  the step. The card glides there over `--cth-dur-slow` (320 ms) as the studio fades in,
  and back on Back; reduced motion jumps. The soft glow behind the page follows: behind
  the card while it is alone, behind the studio after (docs/designs/onboarding-centered.md). Labels `t-ui` 600 at 12, fields v2 (`cth-input`: Sora, `line-input`
  ring, indigo focus ring; the folder path in mono). The Meet step lists what the office does
  as quiet rows in one `line` card, a 26 px neutral icon and a label each, the explanation
  behind an info icon (review, 2026-10-01: it was a grid of tinted tiles, one coral).
- **Team step**: heading "Your team" with an info icon, one line "Suggested for Pro
  Services. You can hire more later." Rows: checkbox, 36 px avatar, name 600, role `ink-3`,
  tags ("in every pack" green soft; "always on" indigo soft for Michael, who has a lock and
  no checkbox), connection chips ("needs: Email" with an indigo dot on `card-2`, "optional:
  Calendar" with a dashed `line-2` border, "nothing to connect" `ink-3`), and a mono
  "Works in Harbor & Pine/Finance" line with a "change" link. Unchecked rows at 55%.
  Footer: "N picked, M to connect" and Back (secondary), Next (primary). The footer sticks
  to the window's bottom edge, so Next stays in reach on a long step. Last in the list, one
  unchecked row for Research (issue #230): Pete's own character, its current name, "Looks things up on the
  internet for the team, and sees no office data.", a "uses the internet" chip in the "always on"
  style; picked, it starts with the team.
- **Ready step** (Get Michael ready, docs/designs/get-michael-ready.md): heading with an
  info icon, then two quiet rows in one `line` card, a 26 px tinted icon each: Claude Code
  (Checking, Installing with a moving `indigo` bar, Installed `green`, or a `coral-text`
  failure line with Try again and Show details) and Your Claude account (Sign in, then
  "Finish signing in in your browser" with Open the browser again and Show what Claude
  says, then Signed in as the email). Beside Sign in, Use an API key (secondary) opens one
  password field in mono with an info icon, Save key and Cancel; then "Using your Anthropic
  API key". When sign in cannot be read, the row shows a neutral question tile, "Could not
  check sign in. Sign in if Claude asks.", Sign in and Use an API key (secondary), and the
  office may open. Footer: Back, Set up later (ghost), and Open the
  office (primary, off until Claude Code is installed and the account row is green or could
  not be checked). Skipped, Ask me keeps a "Michael can't
  start yet" card ("Some of your team can't start yet" when Michael runs on another engine)
  that opens the same rows in a dialog.
- The studio on the right fills with a pod per picked person around Michael's glass pod,
  each with a small name tag and a check on its screen; an unpicked department shows as a
  dashed outline with a "Name, not picked" tag on its back corner, clear of the pods in
  front of it.

### 7.25a The crash screen (ErrorBoundary)

When a screen throws, the window shows one centered line in `t-ui` 600, "Something went
wrong on this screen.", and a primary Reload button under it, on the page background, instead
of a blank window. Nothing else: no stack, no codes (they go to the log).

### 7.26 Settings and the hire wizard

Keep every section, control and save rule from v1 (see the functional map in
`docs/designs/studio-home.md`), restyled with §7.7 buttons, §7.12 row groups and §7.23
dialogs. The hire wizard's steps are numbered circles (done `green` with a check, current
`ink`), its character tiles and job rows use the `indigo` soft selection, and its strings
are sentence case. Closing time is the closing bar (§7.23), not a dialog.

**Edit agent** (`docs/designs/edit-agent.md`, owner 2026-10-02) changes only what can change on
someone already hired, in one column, laid exactly over the person's panel it edits (its
box and radius, kept in step on resize; with no panel, 640 wide, full height, on the right,
left in RTL): Name, Role,
What they handle, Work style (it takes the height left over), then a folded "Engine" line
that names the provider and model and opens to change them. Under the engine, for anyone
who can be deleted (never Michael, his assistant or Pete), the Danger zone: one coral
tinted row, r-xl corners and the 1.5 px coral ring of §6.3, its name with an info icon and
the destructive Delete button. No section headings; field
labels only, with explanations behind info icons. The character is chosen once, in the hire wizard, and a
person's color is their department's, set by the job; Edit agent offers neither.

**Mailboxes** (Settings, Connections; `docs/designs/mailboxes-fold.md`, owner 2026-10-01) folds so
many mailboxes never mean a long scroll. One header line: the `Disclosure` caret, the title, the
count ("14 mailboxes", "none yet"), the coral "N needs you" when one is broken, an info icon with
the intro, and Add a mailbox. It starts closed and opens by itself when a mailbox needs you;
broken mailboxes sort first, then A to Z. Gmail on the owner's Claude account is not a row here;
the info icon says it is under Claude connectors. A mailbox other team members send only from
shows "Also sends from here: ..." under its row, and removing it names them too.

**Claude connectors** (Settings, Connections, first; `docs/designs/claude-connectors.md`, owner
2026-10-02) folds the same way: caret, title, "8 connectors, 3 on", an info icon, Refresh. It
starts closed and opens by itself for a connector the owner has not seen or a failed read. Rows:
name (14px, 600), status in words (connected, an underlined "Sign in at claude.ai" link, or a coral
"Removed from your Claude account" chip with Clear, sorted first), then the owner's switch. A
failed read is one line with the time of the last good read and Try again.

**Research & privacy** (Settings, after Connections; `docs/designs/research-agent-privacy.md`,
owner 2026-10-13). Only Pete, the Research team member, uses the internet; this section turns him on
and sets what the team may send him. Pete first: a `sectionHead` "Research" with an info icon, then
one row whose state line is `role="status"`: grey dot "Off. Pete can't look things up for your team."
with Turn on; a 12 px `indigo` spinner and "Hiring Pete…" or "Turning off Pete…" with no
button; green dot "On. Pete looks things up for the team." with Turn off; coral dot "Pete
couldn't start." with Try again. Turn on and Turn off act at once, never at Save. Turn off with asks
waiting shows one line under the row, "N asks are waiting. They go back to the sender.", with Cancel
(focused; Esc cancels without closing Settings) and Turn off (primary). On Windows one `ink-3` line
under the row: "On Windows, Pete can still reach your office files." with an info icon. Then a
hairline and "What your team may send to Pete" with an info icon and the computed count ("4
allowed, 8 private"); while Pete is off, "Used when Pete is on." in `ink-3`. Twelve 40 px rows
in a fixed order, never re-sorted: the class name, an info icon with its examples, and the Sending
style segmented control [Allowed, Private] (a radio group named by the class); Passwords and keys
shows a 12 px lock and "Always private" instead. The classes save with the footer Save. When a team
member runs on another engine, one `ink-3` line under the classes names them ("Kelly run on another
engine, so these rules don't reach them yet.") with an info icon. The send heading is a sentence
(`t-ui` 600, `ink-2`), not a caps label. The section shows in every office (owner, ship 2 D16).
Pete's Access tab shows one `ink-3` line (no
mailboxes, connectors or schedules) and a link here. Every message to Pete passes his trust
layer: a sender whose question was cleaned gets "Sent to Pete as" from Privacy check in its
Messages, showing what Pete was asked. Pete is the default name: in Edit agent the owner may rename
the Research member (an info icon says it stays the Research member whatever its name), and every
string here takes the current name. Its engine offers Claude only, shown as plain text once on
Claude.

**Company knowledge documents** (Memory & Knowledge, owner 2026-10-19): company knowledge has no
switch; its title carries an (i). Under Add files, a "Documents" label with its (i), then a list in one `line` framed box
(scrolls past 300 px): each row the title in `ink-900` 13 px, under it the file name and "added
19 Oct 2026" (or "updated ...") in `ink-500` 11.5 px, and Open (secondary, small) at the end. Open
opens the store's copy in the owner's own app; a save there is read in again and a polite line
says "Read in your changes to Price list." (or why it couldn't, as an alert). Company
foundations carries a `neutral-soft` "Read only" tag with an (i) and opens as a read only copy.
Search by meaning sits inside the same Company knowledge block, under a `line` rule, with no
switch: it runs whenever MemPalace is installed. Its row is "Search by meaning" with its (i) and,
at the end, the status dot and Ready, Getting ready or Not set up; then the not installed card
that opens Prerequisites, and the Search language pair (Fast, Multilingual) as a radio group with
an (i) saying a change indexes the documents again, drawn with the app's option rows
(`cth-askme-opt`: hover, focus ring, `indigo-soft` picked with a radio dot; arrows move and
pick); title 13 px, detail 11 px `ink-500`. Open opens only document types (OPEN_EXTENSIONS) as themselves; anything else
opens as its text, read only. There is no separate
Semantic memory section; Michael's Memory tab searches the team's notes by exact words only.

---

### 7.27 Pulse (PulseView)

The office's performance and cost as pictures (docs/designs/team-performance.md; approved
mockups `pulse-final.html` and, for the top area and Team at work, `pulse-v3.html`, owner
2026-10-15). A fixed view tab between Tasks and Who talks to whom. It takes
the whole window: no right column and no bottom bar (owner, 2026-10-15). Opening Needs you
or a person goes back to the office, as from Tasks; the bottom bar stays mounted, hidden, so a
half written message survives the switch.

- Header: "Pulse" `t-view`, a period select (Today, This week, This month; weeks start
  Monday; remembered), then **Compare** (owner, 2026-10-16): the app's switch (§7.12, green
  when on) reading "Compare", spoken "Compare with yesterday / last week / last month", with an
  (i): "Both bars count the same days so far." Remembered. While the span before starts before
  the first live recorded day, it keeps the owner's position, greyed and not clickable, and its
  (i) says "Too few to compare yet. This month can compare from 1 December." Then "Collecting
  since" in `t-meta` `ink-3`. A first start reads the eight
  weeks before it from the office log, members' sessions and the cost ledger, so Pulse never
  starts at zero; recommendations still count from live recording.
- **Recommendations** first (owner, 2026-10-15): up to three recommendation cards in `amber` soft with a 1 px `amber`
  border at 40%, never a left stripe (that stays Ask me's); avatar, title 13/600, evidence 12
  in `amber` text, primary Apply, secondary Not now, and a `green` soft "Saves about $N a
  week" chip. An applied card turns `green` soft with "Applied." and Undo. Beside them, once a
  change was applied, Saved by your changes: "Measuring" with the first result date for 7
  days, then mono dollars in `green` text; before any change it is not there. With nothing to
  recommend, no card: one short `t-meta` `ink-3` line under the header, "Nothing to change
  this week", or before two full weeks of work "Advice from Thu, Oct 29" (owner, 2026-10-19).
  Before two full weeks, when the advice rules already see something (owner, 2026-10-19,
  design A, mockup `pulse-early-patterns-20261019/early-patterns-variants.html`), insight
  cards take that line's place: one `card` whose header is lit with an `indigo-soft`
  gradient, holding an `indigo-soft` "Early look" pill with the sparkle icon, the bold 14 px
  "What Pulse sees so far, not advice yet." and, at the end, the countdown ("Day 5 of 14", a
  120 px `indigo` bar, "Advice from Thu, Oct 29"). Below, up to three `card-2` cells in the
  recommendations grid: avatar, name and job (or role), the count in mono 26 px with "of 76
  runs" in `t-meta`, an 8 px bar of the two sides (`ink-4` found nothing, `green` found work
  or kept), and what it means ("found nothing to do so far"). A free cell reads "More patterns
  show here as your team works." in a dashed frame. No buttons; a model fact names no model;
  each cell is spoken as its full sentence.
  The header's (i) then gives the start date and why, in business words (never "records"): a
  few unusually busy or quiet days alone could lead to the wrong advice.
- **What got done**: four tiles (emails organized, emails sent for you, tasks finished,
  scheduled checks), each a line icon (mail, send, check, clock, 18 px `ink-2` on a `card-2`
  square), a mono 28 px number, a label, and a who did it bar: members of one department take
  its `acc`, then `m`, then `d`, with a 2 px gap and a named legend.
- **Only tiles with something to say** (owner, 2026-10-19; docs/designs/pulse-smart-view.md):
  the What got done, Kept safe and row of four tiles flow into one grid under "What got done",
  in this order: emails organized, emails sent, tasks finished, scheduled checks, questions to
  the internet, web answers cleaned, messages held, steps blocked, what the team learned,
  questions to you, Spent, your time. Each keeps its own build. A tile shows when something
  happened in it in the period, or in the span before while Compare is on: web answers count
  every answer checked, Questions to you the questions, Your time the questions or any work
  while the owner was away, every other tile its number. Spent always shows. Otherwise the tile
  folds into a **quiet chip**: a 26 px pill, `neutral-soft` fill, no border, a 14 px `ink-3`
  line icon, the name in `t-meta` `ink-2` and the count in mono `ink-3`; on hover the `card`
  fill and a `line-2` hairline. Chips sit in one wrapping row under the grid, in its order.
  A chip is a button ("Emails sent: 0 today. Show tile."): it puts the tile back in its place,
  moves focus to it and reads it in a polite line; opened tiles stay until the period changes
  or the owner leaves Pulse. A tile or chip that moves fades and slides in over 150 ms on
  `--cth-ease`; reduced motion snaps. The grid keeps 4, 2 or 1 columns; fewer tiles leave the
  end of the last row empty.
- **Kept safe**, with no header (owner, 2026-10-15): four tiles of the same build (line icons
  shield, search, pause, lock), in the What got done grid. Each names its number in a few words,
  and its own (i) says how (owner, 2026-10-18: fields only): "questions to the internet" (As
  written, Private parts removed, Stopped; the (i): each question is checked for private details
  before it goes out), "web answers cleaned" with "of N" (Cleaned, Already clean, Flagged to
  Michael; the (i): hidden instructions to AI agents are taken out before the team reads them),
  "messages held" (`amber` soft while above zero; the (i): the message waits instead of going out
  unchecked), and "steps blocked by your settings" by gate (Unconfirmed sender, Connector off,
  Outside the sandbox, Internet, not research, and the rest). A tile's bar and legend show only
  once one of its parts is above zero. A held message is never counted as protection. Above zero, the held tile carries "See what was held"
  (12/600, `amber` text), which opens a list in the member detail's frame (owner, 2026-10-16):
  per held message a `card-2` row in the owner's words (owner, 2026-10-16): a 13/600 headline
  saying what was not sent ("Pete's notes were not added to the team's shared knowledge",
  "Pam's question to Pete was not sent") with the time at the end, the subject in quotes and
  the start of the message (two lines at most; none for Pete's notes or the app's own
  reminder), one `amber` sentence on why with the check's own report behind an (i), and one
  `ink-3` sentence on what happens next and whether the owner needs to do anything. When the
  count is above the rows, one line says how many more have no details. A read that fails says
  "Couldn't read the list." with Try again.
  The questions tile carries "See each question" and the answers tile "See each answer" (12/600,
  `indigo` text, when the count is above zero), each opening a list in the same frame (owner,
  2026-10-16; mockup `checked-lists-v2.html`): under the title one count line for the period with
  an (i) on what the marks mean; changed, stopped and flagged rows first, each a `card-2` row with a
  13/600 sentence headline ("Pam's question to Pete had private parts taken out", "Pete's answer to
  Pam had web instructions taken out and was flagged to Michael") and the time at the end; the
  text with removed words struck through (`ink-3` on `neutral-soft`) and the other side's words on
  `green-soft`, or, when over 40% of what went out is new or there are more than 4 changes, the two
  texts under 10/600 caps captions; long texts show the changes with about 80 characters around
  them and "Show the whole answer"; hidden characters show as "[12 hidden characters]"; "Taken
  out" kinds as `green-soft` pills, "Needed" and "Flagged to Michael" as `amber-soft` pills; one
  `ink-3` sentence on who was told and whether the owner needs to act. Rows sent as written fold
  into one line ("17 sent as written") that opens one line items between hairlines. The
  questions list points to the held list when the period has holds. Every text is plain,
  `dir="auto"`; marks carry hidden "taken out:" and "sent instead:" for screen readers.
- **The four tiles after Kept safe** (owner, 2026-10-15), in the same grid, each only as big as what it
  shows, 12/14 px padding: What the team learned (the period's new notes as one mono 24 px number, a bar and legend by
  source: `green` your answers, `ink-4` on the job, `indigo` Michael; under it the notes and
  written ways of working held in all), Questions to you per 100 requests in the period (one
  number with its counts; under 20 requests, too few to tell), both following the period
  select (owner, 2026-10-15), Spent with plan use (a mono 24 px total with what it is beneath at the top;
  plan use at the foot as a full width 8 px bar with its percent and reset day, on a Claude
  plan only, turning `amber` with a soft "Runs out around …" when the pace says so; who spent
  what is Team at work's job), and Your time with While you were away past a hairline (the
  number at the top, what it means at the foot).
  Each tile spreads its content top to bottom so none holds an empty foot. On a Claude plan with a known price
  (Settings > Agents, else the plan found in the owner's Claude account), every dollar on
  Pulse is a member's part of the plan's real cost for the days so far in the period, split by
  their share of the work (their pay per use value); the line under Spent reads "of your
  Claude Max 20x ($200 a month)" and the pay per use figure sits behind its (i). On an API key
  the dollars are what was spent; on a plan with no known price, pay per use with a pointer
  to Settings. Team at work's column then reads Cost, not Value. Two columns under 1100 px,
  one under 760.
- **Team at work** last, in place of the member tiles (owner, 2026-10-15): one card with a
  headline (the two busiest members' share of working time, who was quiet, who cost the most
  for the least work), then a row per member on the team, Michael included, busiest first:
  avatar ringed in department `acc`, name and role, a working time bar in that `acc` with the
  team average as a dashed mark, hours and cost (no day strip, per hour or Knows column,
  owner 2026-10-15). Callouts sit on the bar's end: Busiest, "Nx the
  team" (twice the average or more), Quiet (some working time, under a quarter of it), and `amber` soft "Costly
  for its work" (twice the usual value per hour, with ten minutes of work and three peers at
  least). Members with no working time fold into one last row, "9 more were quiet" in `ink-3`
  with a chevron, a disclosure button that opens their rows (owner, 2026-10-19); the headline
  names only members with some time. With nobody working, the headline reads "Nobody has
  worked yet today" (this week, this month) above the folded row. A row opens the member
  detail, an overlay like Task detail (§7.21): six facts in `card-2` boxes and a four week
  value bar.
- **Compare** (owner, 2026-10-16): with the switch on, every top tile shows two small bars
  under its total, the span before and this one, named Yesterday and Today, Last week and This
  week, Last month and This month. The span before runs up to the same day: all of yesterday;
  last week's Monday to the same weekday; last month's 1st to the same date, capped at its last
  day. The earlier bar is muted (`ink-4`, or the series color at 45%) with a 1 px `ink-3`
  outline; this one is `ink-2` or the series color; the value sits above each in mono 10 px.
  Bars take the place of who did it and of Kept safe's breakdown while Compare is on. A span
  with too few requests for a rate draws no bar and reads "…". Team at work shows the period
  only. With Compare off, no tile compares.
- Layout by the window's width: 1100 px and wider, 4 a row and every Team at work column;
  760 to 1099, tiles 2 by 2; under 760, one
  column and Team at work with name, bar, hours and value. Coral is never used on Pulse. Every chart has an
  aria-label sentence; Apply and Undo announce in a polite live region.
- **Company foundations** (docs/designs/office-foundations.md, design D3 to D9, D14). The strip
  sits inside Recommendations, one row under the Early look header while it shows, else a
  `card` row at the top of the section: "Foundations" in `ink-3` with its (i), then one pill per
  job whose work hit an empty question, most hit first: `neutral-soft` pill, 30 px, the job
  name, "1/6" in mono and a 42 px `indigo` bar on `line-2`. A pill is a button named "Marketing,
  1 of 6 answered. Open its questions"; it opens that job's waiting foundation card in Needs
  you, else the Company foundations document as a read only copy in the owner's own app
  (Settings at Memory & Knowledge when it can't open). A job leaves once every question its work hit is
  answered; the strip goes with the last. On Team at work a member missing any foundation shows
  a 12 px `indigo` ring and "Foundations 2 of 6" in `ink-3` 11 px under its role; nothing once
  all are answered. Member detail adds a Foundations box in `card-2`: the ring and "1 of 6",
  the missing questions the work hit as `indigo-soft` pills (each opens its card), "and 3 more
  no work has needed yet", and, once both sides have enough work, two bars of work kept as is
  without the first answer (`ink-4`) and with it (`green`).

### 7.27a The foundation card (FoundationCard)

A Company foundations question on Needs you (docs/designs/office-foundations.md, design D2,
D8, D10 to D13), listed after the decision cards and before reports, always open:

- **Title** the question in 14 px semibold ("Who we sell to (ideal customer)"); under it the
  usual raiser chip in the member's department colors and "needs this, 2h ago" in `ink-3`.
- **Evidence first**: Michael's one bold line on what the work did without it, as Ask me
  markdown with file chips.
- **Your answer**: a visible 11 px `ink-3` label, a multi line `cth-input` box (max 300
  characters) and the hint as a line under it, linked as its description; the hint never sits
  inside the box.
- **Actions**: Save answer (primary), Have Ryan draft it (secondary), Not now as a quiet text
  link at the line's end. At 320 px Save and Draft share a line and Not now wraps.
- **Drafting**: a polite status line in `indigo-soft` ("Ryan is drafting an answer from what
  the office holds."). Save stays on, so the owner can always type their own answer (review,
  2026-10-20); a request waits 2 days, then Have Ryan draft it shows again. The draft fills an
  empty box once, the label reading "drafted by Ryan, edit and save" in `indigo-text`. Draft
  it shows only while the member is on the team.
- **Footer** above a `line` rule: "Sales and Marketing use this" and "Asked weekly until
  answered", both `ink-3` 11 px.
- A failed action keeps the typed answer and names what failed in `coral-text`: "Couldn't
  save, try again.", "Couldn't ask Ryan to draft it", "Couldn't put this off". A saved answer
  shows "Saved to Company foundations." in a polite line at the top of the board (or "Sent to
  Michael to add to Company foundations." when the write fell back to him), only once it is
  saved. The draft label names who filled it. A card whose question was answered another way
  leaves the board. Not now
  hides the card for a week; the Needs you count leaves it out too.
- **Company knowledge is always on** card (one time, a report like the Research notice): for an
  owner who had turned company knowledge off and has documents in it. Got it, and Open the list
  (Settings, Memory & Knowledge).

## 8. The studio illustration [Both]

The studio is both the app's Office view and the website's hero. One construction, two
uses: live in the app, a curated still or light loop on the web.

### 8.1 Projection

Isometric, 2:1. With grid unit `S` (50 px at a 1060 × 816 stage) and origin `(cx, cy)`:

```
P(gx, gy, z) = ( cx + (gx - gy) * S,  cy + (gx + gy) * S / 2 - z )
```

Every shape is built from boxes (top, left and right faces) and ellipses on this grid.
Faces: top = lightest, left = `m`, right = `d` of the object's family. A 1 px white rim
at 75% (dark: 13%) runs along the top front edges. Strokes match fills; no outlines.

### 8.2 Platform

A raised floor slab in `floor` tones: top `#F1EFFB` to `#E4E1F5` (dark `#302B49` to
`#26223B`), left `#D7D3EF`, right `#C6C0E6`, a white grid at 70% (dark 5%), a soft
`#8A82C9` shadow at 22% beneath (dark black at 55%). The stage ground carries the radial
light (§3.8) and a faint dot grid masked to the edges.

### 8.3 Pods

A department pod is a desk block, a glass monitor on a stand, a chair, a keyboard, and a
small plant or mug, all in the department family (§3.4) on a paper pad slab. Each desk carries
its person's prop (§3.4) at the front left corner, and Michael's desk his mug. Open floor
holds three potted plants and a water cooler (`DECOR` in StudioArt), on spots clear of
every ring slot, the mailbox row and Michael's office. A pod holds one to
four desks (§8.9). The monitor screen is the status surface:

- Glass (owner, 2026-10-15; `docs/designs/office-floor-plates-glass.md`): every monitor,
  Michael's included, is a frameless slab 0.02 deep (faces `rgba(220,228,246,.35)`,
  `rgba(226,234,250,.2)`, `rgba(200,210,236,.35)`), no bezel and no white edge; the pane
  fills it. Before, a thick dark frame read as an old monitor.
- Idle: a clear pane, `rgba(226,234,250,.38)`, with a soft white reflection
  (`rgba(255,255,255,.55)`) across its left side.
- At work: the glass takes the color it shows at about 13% (`acc`, `violet` while
  thinking or compacting, `coral` when asking for help), its lines scroll while working,
  looping, thinking or compacting, and a floor glow ellipse in `acc` at 42% core, 14% edge
  (dark 62% and 22%). In dark theme the screen halo is 25%.

**Department plate** (owner, 2026-10-15): owners who don't know the show see only
names, so each pod says what it does. A plate lies on the pad in the floor's plane (the
plane of Michael's name plate), right in front of the front chairs: its center 0.1 grid
past the chair backs (0.53 past their desks). The pad grows only by what it needs: deeper
at the front by `max(0, plate + 0.12 - half depth)`, and wider when the word is longer
than a one person pad. White at 92% (dark `#24222F`), 9 px tall, 0.7 px `acc` border, `r`
2.2; the department name (`studio.dept`, "HR" for people) in Sora 700 at 5.8 px, capitals
spaced 0.5 for Latin words and unspaced for scripts that join, such as Arabic.

### 8.4 Michael's glass pod

A raised platform with a glass box (back wall white at 78%, front at 42%; dark: indigo
tinted at 20% and 10%), two monitors, a ring on the floor in `indigo`, and a name plate on
the front glass just right of his door, sized to the glass: a 12 px tall ink plate, his name
in white Sora 600 at 8 px (shortened with an ellipsis past 12 letters), and a status light
that glows green while he works; it always ends before the glass's corner (owner,
2026-09-30: an "M" badge said nothing; a door plate says whose office it is). It sits at the center of the platform. The glass is taller
than a desk (72) so his walls carry his numbers:

- Left wall: the task board. To do, Doing, Waiting (`amber`), Blocked, Done read left to
  right, as the Tasks view does, so the wall adds up to it (owner, 2026-10-18); five columns
  fill the board the way four did. Each column's count in mono inside the board's top (never
  on its edge) in the column color, up to four stickies under it. Stickies pop
  on; Doing breathes; his marker writes under the columns while he works.
- Right wall, above the monitors: a lit sign (ink, indigo rim) with three mono numbers and
  glyphs: handed out today, waiting on you (coral when above zero), kept; his context gauge
  along its bottom (indigo, amber at 65%, coral at 85%). Numbers tick when they change.
- The clock (real time, rings for scheduled jobs) at the front end of the left wall, with
  clear space between it and the board.

### 8.5 States on the stage

As §3.5. In addition:

- **Selection**: a dashed `ink` ellipse (6 4 dash) on the floor around the selected pod;
  everything else at 45% opacity.
- **Needs you beacon**: a coral sphere on a thin pole above the pod with a ring that scales
  from .6 to 1.5 and fades, every 1.8 s. Only for status `blocked` on the owner.
- **Thinking**: a white bubble with three `violet` dots over the monitor.
- **Idle**: the pod desaturated; the screen clear glass (§8.3).

### 8.6 Paths and tokens

- No standing paths (owner, 2026-09-30: permanent lines made the office look busy). A path
  is drawn only while something moves along it: a token's own faint trail as it flies,
  Michael's wire to a pod for 3.2 s when someone there starts working, a mailbox's wire
  while mail moves, and a conversation arc while two people talk (§8.12). A broken mailbox
  shows its warning on the post and its tag, not a line.
- Tokens are small isometric cards or glyph circles in the act color (§3.3), white ring,
  traveling along paths, 2.2 s each with ease in out. At most 16 in flight; past that the
  oldest leave first.
- Flow rules, which mirror the product: each mailbox post feeds the person who watches it
  (a team member reads its own mailbox; mail does not pass through Michael); Michael feeds everyone; teammates exchange `query` tokens directly;
  a teammate who is stuck sends a `query` to Michael; only Michael sends `act-you` tokens,
  which leave the stage toward the right column.
- A `done` message travels as a green check token; a task reaching Done bursts a check over
  its owner's pod and pops a sticky onto Michael's board (§8.12).

### 8.7 Mailbox posts

Small isometric posts at the platform's front left edge, one per mailbox, in white and
lavender with a slot and a flag, each with a mailbox tag (§7.18). A broken mailbox's post
is coral tinted with a blinking red "!" above it (there is no path to carry it, §8.6).

### 8.8 Idle quote bubble

One at a time, from someone in a quiet pod (owner, 2026-09-30: the first version was easy to
miss, and a bubble floating apart from the person's tag looked wrong). The bubble belongs to
the pod chip (§7.14a): a `card` speech bubble, max 250 px, ring and tail in the speaker's
department color, the line in quotes at 12.5 / 17 `ink`, with the speaker's name on top only
when the chip holds more than one person. Its tail points at the speaker's avatar on the
chip, which gets a 3 px ring in the same color and a small hop. It opens up from the chip,
or up and leftward, or down under it, whichever first covers no open card or Michael's.
It pops in from the tail, holds, and fades. Lines are the Office lines in
`cafeteriaLines.ts` and nothing else (owner, 2026-10-01: "dont show made up lines"): the
speaker's own about 60% of the time, else a break-room line, dealt like a deck so none comes
back until its pool has run out, and never the same speaker twice running when someone else
could speak.

**Banter.** A little over half the time, when two quiet people sit in different pods, they
trade an exchange instead (owner, 2026-10-01: Kelly and Ryan throwing paper planes or mail
at each other). Each beat flies pod to pod as a paper plane, never an envelope (owner,
2026-10-04: envelopes are only real messages between the team; a plane is banter or what passes between the owner and Michael), in the sender's department color, and on landing shows in the catcher's
bubble with the sender's name on top and the sender's color on the ring. Each line holds 2
to 3.6 s by its length while the reply flies back, so the conversation reads in order; the
last one holds a little longer. Exchanges are the full set in the file: `EXCHANGES`, the "that's
what she said" bits (owner, 2026-10-01: "bring full set back") and each character's
signature opener (once a day). A bit that belongs to someone on the show says who may say
each side (Michael lands "that's what she said", Andy went to Cornell), and the partner is
picked to fit; a break-room line never names its own speaker (owner, 2026-10-03). A
conversation ends early if either person gets work.

**Pete.** The Research member takes part like everyone else, in his own character (owner,
2026-10-13). His lines come from his season 9 story, written in his voice: Andy calls him
Plop, he is the New Jim with nothing in common with Jim, he recites Die Hard for Erin, Poor
Richard's after work, Kelly's old customer service desk, and the office sizing up the new
guys. No line says "Pete", since the owner may rename him. The one exception to the deck:
**his first day welcome.** After the owner turns Research on, the first conversation that
can be one of Pete's is, with someone in another pod, under the same pod rules. It plays
once per turn on, kept per office; once played, a restart or a restore does not replay it
(an office with no record of it yet, such as one that had Research on before it existed,
plays it once), turning him on again does, and demo or lab banter never uses it up. Idle talk, his included, does not
run in the compact grid (§8.9).

The first line or conversation comes 8 to 15 s after the office opens, then every 15 to
30 s. A single line is visible 8 s. Never from a pod with someone at work, and never from
someone still clocking in.

### 8.9 Scaling rule

- Departments, not seats. Each department has one pod holding up to 4 desks (1: single
  desk; 2: side by side; 3 and 4: a 2 × 2 cluster). A fifth person in a department opens a
  second pod for it.
- Up to 9 department pods sit on a ring around Michael's pod, each department in the same
  slot every day (front desk, marketing, support, sales, finance, IT, people, then
  operations front left and the team pod front, its card toward Michael; owner,
  2026-10-03). A second pod for a busy department takes any free slot.
- More pods than slots, or more than 28 people, switches the Office view to a compact grid
  of label cards grouped by department, with the same states and badges.
- A department is read from the job card a person was hired with, then their character's
  usual job, then the start of their role line; anything else sits in the team pod.
- One person (Michael only): the platform with the glass pod alone.

### 8.10 Themes and direction

- Dark mode: every face value has a dark twin (§3.4 derivation, platform per §8.2).
- RTL: the art never mirrors (it is a picture of a room). Labels keep their positions.
- Reduced motion: §11.3.

### 8.11 Web use [Web]

- Hero: a curated still of the studio at hero size (the reference home screen's stage,
  without the Needs you column), exported as SVG. Optional light loop: record the studio lab
  (§8.13, `?clean&autoplay`). No live data.
- Feature vignettes: crop to one idea: the mailbox posts feeding pods (mailboxes), the
  onboarding studio filling (packs), one pod with its Access card (limits), Michael's pod
  sending a token to a Needs you card (Ask me).
- Screenshots of the app go in a macOS window frame: `r-2xl`, `shadow-lg`, the title bar
  with traffic lights.

### 8.12 Life on the stage

The office moves when the work moves (owner, 2026-09-30: the first build felt static).
Every effect starts from a real event or state; nothing is decorative noise.
`scene/studio/life.tsx` holds the event layer.

| Trigger (real) | What moves |
|---|---|
| Hive message between people | The token travels its wire with a bright trail, a puff where it leaves and a ping where it lands (2.2 s, eased) |
| Message from the scheduler (a scheduled run) | The clock on Michael's left wall (real time) rings, then an amber clock token travels to the pod; the job's name shows in front of the pod for 4.5 s |
| Mail tool call (`md-mail` search or read, draft or send) | The watcher's mailbox hops and raises its flag, its wire flows, and an envelope travels in (read) or out (draft, send) |
| Any other tool call | A 26 px glyph rises off the desk: web, terminal, file, search, books, or a spark (one per person per 1.4 s) |
| A task reaches Done | A green check bursts over its owner's pod; a new sticky pops onto Michael's board |
| Counts change | Michael's numbers tick up into place |
| Someone starts working | Michael's wire to the pod appears, flows toward it and fades (3.2 s) |
| Someone working | Their screen scrolls, their mug steams |
| Michael working | His screens scroll, his marker writes on the board, his name plate's light glows; Doing stickies breathe |
| Thinking | The three dots bounce in turn |
| Always | Plants sway slightly (5.5 s) |
| Michael hands work out (`request` from Michael) | He points first: a soft beam from his office lights the pod's floor, then the envelope leaves |
| A question for the owner (a message to the owner, or a new Needs you item) | A paper plane flies from Michael's office toward Needs you, and the Needs you button bumps as it lands |
| Two people message back and forth | A dashed violet arc joins their pods with a count bubble; it fades a minute after their last message |
| Two quiet people banter (§8.8) | A paper plane in the sender's color flies pod to pod; the line pops up on the catcher's chip as it lands, and the reply flies back |
| The owner messages Michael (from `human`) | A paper plane in the owner's indigo rises from the composer under the stage to Michael's office, like the one he throws to Ask me in coral, and lands with two rings |
| A new team member appears on the roster after launch | Their pod drops in, confetti in the department colors, and "Welcome, Jim" in front of the pod |
| The office opens (each person's action is the clocking in marker) | Every light starts off. Michael's office comes on when he is in, a pod's when the first of its people is in, each desk when its person is; a light that comes on flickers like a strip light. A desk stays dark at most one minute, so a quiet engine never leaves it off |
| Closing time (`onClosingTime`) | Each person's desk goes dark and they leave the chip as they confirm or are excused; a pod with nobody left goes dark and its chip fades out; Michael's office goes dark when it completes; cancelling brings it all back |
| Local time | Morning sun from the left (6 to 10), plain daylight, a golden evening (16 to 19), and a darker night (19 to 6) where working desks and Michael keep warm lamps on |

All of it pauses with the stage (§11.2). With reduced motion the loops stop and a token
appears at its destination for one second.

### 8.13 Studio lab [Both]

`tools/studio-lab` (owner, 2026-10-01): the real studio on a fictional office (Harbor &
Pine), with a button for every effect in §8.12, each firing the event the app listens to.
`npm run lab` writes `docs/demo/studio-lab.html`, one self-contained file (script, styles,
fonts, images inlined) for demos, screenshots and videos. Its sibling page
`reference.tsx` composes the app's shell for the reference screens (§20).

- Every pod shows its chip (`quietCards`); a card opens on hover, or for a moment when a
  button involves someone (`cth:demo-spotlight`), one at a time.
- "Autoplay the day": the office closed (every light off from the first frame), the
  opening, then everyday events in random order every 2.6 s, never the same twice running.
- H hides the controls. URL: `#dark`, `?hour=22`, `?play=<label>`, `?autoplay`, `?clean`.
- A test keeps it building, self-contained, and free of any real office's data.

---

## 9. Web components [Web]

### 9.1 Nav

72 px, `bg` at 85% with a 1 px `line` rule on scroll. Lockup left; four links center
right (`w-small` 500, `ink-2`, active `ink`); a primary button (ink) that reads "Download for Mac" or "Download for Windows" from the visitor's OS, "Download" otherwise.
Phone: lockup plus a menu button; the sheet lists the links and the button.

### 9.2 Buttons

Primary `ink` fill, white `w-small` 600 text, 44 px tall, `r-md`, padding 0 × 20.
Secondary `card` with `line-2`. Never coral (§3.2).

### 9.3 Hero

Eyebrow (mono, `ink-3`), `w-display` headline, `w-lead` subline in `ink-2`, primary and
secondary buttons, then the studio (§8.11). The radial light sits behind the studio.

### 9.4 Feature rows

Alternating text and vignette, 96 px apart. Title `w-h3` or `w-h2`, one or two short
paragraphs, an optional mono eyebrow. Vignettes sit on `card` with `r-2xl` and
`shadow-md`, or bleed without a card when they are studio art.

### 9.5 Cards, chips, pills

Same as the app (§6, §7.13): `card`, `line`, `r-xl`, `shadow-md`.

The home page's "Everything else" list is six tiles: three across at 980 px and up, two
across from 481 to 979 px, one column at 480 px and under (owner, 2026-10-09). A tile is an
`ink` 20 px icon on a 36 px `neutral-soft` square, a `w-h3` title and one or two lines in
`ink-2`. The Ask Michael tile adds decorative status pills (§7.13 colors: Sent idle, Michael
has it working, Waiting on someone `amber-soft` with `amber-text`, Answered done), hidden
from screen readers; its text carries the meaning. Its last line also says that when Michael
offers choices you pick one and press Reply, and his pick is tagged (§7.8; owner, 2026-10-19).

### 9.6 Footer

`chrome` ground, lockup, link columns (`w-small`), Discord, GitHub, FAQ, legal line.

### 9.7 Social card

1200 × 630, `bg` ground, lockup at left top, `w-h2` headline in `ink`, a line in
`ink-2`, and the studio crop on the right. Generated by `source/build.py` (§14).

### 9.8 Platform switch (download page)

Two native buttons in a group labelled "Your computer" ("Mac", "Windows 11"; owner,
2026-10-09: Windows is billed as Mac's equal, so no Beta tag), `aria-pressed` on the chosen one, the same pattern as the setup picker. Pill track
`neutral-soft` with an inset `line`, padding 4; the chosen segment is `card` with
`shadow-sm` and a `line` ring; labels `w-small` 600, icon 16 px, 44 px tall, `indigo` focus
ring. Preset from the visitor's OS, overridden by `#mac` or `#windows`. Without JS the
switch is hidden and both platform panels show, Mac first. Under 480 px it spans the column
in two equal halves (`minmax(0, 1fr)` columns); under 420 px it drops its icons. Without JS each platform's steps get a visible "Install on a Mac" or
"Install on Windows" heading.

### 9.9 Beta tag (web)

Retired on the web (owner, 2026-10-09): Mac and Windows get equal billing, and the app as a
whole stays pre 1.0 in the footer's legal line. The Windows panel on /download keeps an
"On Windows, for now:" note for what still differs: a `card-2` panel with an inset `line`,
never amber, a bold lead line and one short bullet per difference (owner, 2026-10-09: one
fact per line so the shell commands caveat is not buried).

### 9.10 Install dialog drawings

Drawn, not screenshotted: the macOS "Not Opened" sheet and the Windows SmartScreen sheet
("Windows protected your PC", one `ink-3` line, "More info" ringed in `indigo`, then "Run
anyway" highlighted like Done) as `card` with `shadow-lg` and `r-lg`, beside a `card-2`
"This is normal" panel. Under 640 px the drawing stacks under the panel.

### 9.11 Sending switch (web)

At the end of the home page's story, under the heading "You choose what goes out.": the
app's Sending control (§7.12) drawn as a real switch. Three native buttons in a group
labelled "How Kelly sends", in the app's order [Can send, Send on approval, Draft only],
Send on approval pressed by default, styled as the platform switch (§9.8). Each choice shows
one card beside it: Can send the sent reply (§9.5 message card, "Sent"); Send on approval
the mail approval card (§7.8: "Kelly wants to send an email", From and To as `t-meta`
lines, Subject and Message as field boxes that are not focusable, then Don't send and Ask
for changes as secondary buttons and Approve as the primary, right aligned); Draft only the
reply with a "Draft" tag and "Saved in support@ Drafts". A line under the switch says what
the chosen setting does (`aria-live="polite"`). Addresses use the story's form ("support@",
"Northwind Cafe"), never an invented domain. Without JS the switch is hidden, the approval
card shows and all three choices are listed in text. Two columns (5:7) at 980 px and up,
stacked below; under 480 px the switch is three equal columns whose labels may wrap to two
lines, and the card's buttons wrap at 44 px tall.

### 9.12 Setup inset (web)

Under the home page's two setup cards, a quiet inset for setup's last step (§7.25 Ready
step): `card-2` fill, inset `line`, `r-xl`, no shadow, padding 16 × 20. Michael's avatar,
"Then Michael gets ready" (600, 14/20), two inline items with 16 px icons ("Claude Code,
installed for you if it's missing" and "Sign in with your Claude plan, or an Anthropic API
key"), and an `ink-3` line under them. No buttons: nothing in it can be clicked. One row at
980 px and up; under that the text stacks beside the avatar.

### 9.13 Task board (web)

A home page section right after the refund story's Sending block (§9.11) and before the
"Everything else" tiles: eyebrow "The board", heading "See every job, and who it's waiting
on.", and a read only picture of the Tasks view (§7.20) in the story's cast. A `card-2`
frame, `r-2xl`, `shadow-lg`, padding 18: the header ("Tasks" 18/24 600, count chips To do,
Doing, Waiting, Blocked in `coral` soft, Done in `green` soft, a lock icon and "New work goes
through Michael" in `t-meta` `ink-3`), then five columns in the app's order on a tinted
`floor` ground, Blocked tinted `coral` soft, with 6 px square keys (`ink-4`, `blue`, `amber`,
`coral`, `green`). Task cards as §7.20: mono id, title, assignee avatar and name. A Waiting
card carries an `amber` soft "Waiting on {who}" chip, one on a customer and one on a
teammate; the Blocked card is the story's refund (Northwind Cafe, Invoice #4471) with the
18 px coral "?" and a `coral` soft "Waiting for you" chip; Done cards show a green check and
the first line of Michael's result (`ink-2`, 11/15), then "N more". Under the frame, three
plain notes keyed like the columns: Waiting says who it waits on, and that when someone
outside the office doesn't reply after two follow ups, Michael asks you whether to keep waiting
(owner, 2026-10-19); Blocked always
waits on you; Done shows what came of it. The frame is one `role="img"` with a full text label;
nothing in it can be clicked. Five columns at 980 px and up. Under that the board leads with
what an owner checks first (owner, 2026-10-12): Blocked and Waiting side by side, Done across
both columns with its cards two across, then To do and Doing as count rows without cards;
under 480 px everything stacks in that order. The board never scrolls sideways.

### 9.14 File tabs (web)

A home page section right after the task board (§9.13) and before the "Everything else"
tiles: eyebrow "Files", heading "Read the file he means, beside his question.", a lead that
names only what opens in a tab (CSV files, notes, text and pictures; never "spreadsheets" or
"in the office", owner CEO D8) and sets the picture later that morning, after the board's
9:15, and a read only picture of a file tab (§7.2) opened from a file chip on an Ask me card (§7.8). Same
frame as §9.13 (`card-2`, `r-2xl`, `shadow-lg`). The top bar as §7.2: Office, Tasks, Pulse,
Who talks to whom, the `line-2` hairline, then two file tabs (a Markdown note, and a CSV that is
selected, `ink` fill, its name whole), each named as the app names it, without folder or
extension (the same name as its chip), and the coral Needs you pill showing 1. Under it, the
file view (§7.2: name, "Oscar / Payments" in `ink-3`, Open in app and Show in Finder) with
the CSV as a table: Date, From, Invoice and Amount, amounts right aligned in mono, eight
September payments, none named like the demo office (Harbor & Pine), whose last row has no
invoice. Beside it, the
right column's Ask me card, Michael's question for Oscar, asks whether that payment is the renewal deposit; the
question names the file as a chip (`sheet` icon, the name without extension, "Open"), an
answer is being typed, and it holds up 2 tasks. Under the frame, three plain notes that add
what the lead leaves out: named files are buttons (Open, or Show in Finder, "Show in folder"
on Windows, for anything else, §7.8, with PDF and Office files opening in their own app); the
question stays beside it (§7.2); and it reads what your business already has: Excel exports
from accounting and payroll software, long PDFs and PowerPoint decks (owner, 2026-10-15; the
five tab limit is left to the app). The frame is one `role="img"` with a full text label; nothing in it
can be clicked. File view and card side by side at 980 px and up; under that the card comes
first (no wider than the app's 520 px right column), then the file, and the tab bar drops Pulse, Who talks to whom and the Markdown tab, then the
Needs you pill under 600 px and Tasks under 480 px, so the selected file tab keeps its whole
name. Under 400 px the table steps down to 11 / 16. The section never scrolls sideways.


### 9.15 Privacy section (web)

A home page section right after the refund story's Sending block (§9.11) and before the task
board (§9.13), owner 2026-10-14 (site design review, direction C2). In place of the eyebrow, a
"Privacy first" badge: a pill in `indigo` soft with `indigo-text`, 15/20 700, an 18 px shield
icon. Heading "A trust layer built to stop agents going rogue and leaking your business data."
with "trust layer" in `indigo-text`; the lead says Pete, the Research team member, does the
team's web research and everyone else is told to ask Pete, every question the app passes to Pete
is checked against what the owner keeps private, and every answer that comes back through the
trust layer is cleaned of instructions before the team reads it. Two columns (5fr 7fr) at 980 px
and up. Left: h3 "You decide what stays private.", one line, the three segment switch of
§9.11 (As written, Cleaned, Not sent; Cleaned pressed first), its live line, then the example
as message cards (`card`, padding 14, the story's cast): Kelly's question to Pete; for Cleaned
and Not sent, a message from "Privacy check" to Kelly (a shield avatar on `indigo` soft, the
sender the app uses) carrying the app's note word for word, "Sent to Pete as" with the cleaned
question in a `neutral-soft` box, or "Not sent to Pete: it contains an account number or ID,
which the owner keeps private. Ask again without it."; for As written, no message and one
line saying Kelly gets no note. Then Pete's answer to Kelly: the app's reply label word for
word in a `neutral-soft` box, the answer, and one struck line (`ink-3`, line through) marked
"removed". Right: a read only picture of Settings, Research & privacy (§7.26): the "Research"
head, a green dot and "On. Pete looks things up for the team." with Turn off, then "What your
team may send to Pete" with "4 allowed, 8 private" and the twelve kinds in the app's fixed
order, each with a segmented Allowed | Private, Passwords and keys "Always private". Under the
columns, three plain notes: Keeps your business data in; Built to stop agents going rogue (what
happens to answers that come back through the trust layer, never "a web page can't give your team
orders"); the setup inset's Pete row says the app gives Pete questions only, never the owner's files,
and its summary is shown in full (the others clamp to two lines on phones) so that clause stays visible whatever
font the phone falls back to; Off until you turn
them on. No card gets a coloured edge stripe. Pete's avatar is the globe
and magnifier icon on `dept-team` l, m and acc (`.d-research`), never a letter, here and in
the setup inset (§9.12), where Pete is the last row, unchecked, tagged "uses the internet".
Pete is "they". The settings picture is one `role="img"` whose label names all twelve kinds;
the switch is buttons with `aria-pressed` and an `aria-live` line. Without scripts the switch
is hidden and the three outcomes stack under their labels. Under 980 px one column: the left
column, then the picture, then the notes. Under 480 px the picture shows the four Allowed
rows, Passwords and keys and "and 7 more kinds kept private", linking to /security. The site
states no limit notes for this feature (owner, 2026-10-14). The section never scrolls
sideways.

### 9.16 Security page (web)

`/security`, a page to read, not to sell (owner, 2026-10-14): the site nav and footer, no
hero, no cards, Download the only call to action. One column at about 70 characters: h1
"Privacy and security", a one line summary, a link back to the home page's privacy section,
then six sections under h2s: Who is given what (Pete does the team's web research, everyone else,
Michael included, is told to ask Pete, and the app turns off the web page tool and the web search tool
for every team member but Pete; one table: your team and Michael "Told to ask Pete", Pete "Yes, the
team's researcher" and "Questions only, never your files", against web pages and search, your
files and mailboxes, and connectors; and
one line: each team member keeps its own notes and inbox, and teammates, Michael included, are
told to ask it instead of opening them), The trust
layer (out: as written, cleaned or not sent; in: instructions removed, the answer labelled, an
answer that tries to steer flagged to Michael; nothing goes through when the check can't run, the teammate who asked is told and so is Michael, and Pulse lists each message held because the check couldn't run (when, who it was between,
what it was about, why, and who was told); every message the app passes to Pete, from a teammate,
Michael, the app or one of your answers, is checked, except the app's own fixed notes, which go as
written; the app gives Pete no files; passwords and keys are always private, and a message with one
in a recognisable shape goes back before any model reads it; every answer that comes back through the
trust layer is cleaned and labelled as information from the internet; Pete's notes are not copied for the team; and one line after the way in: since 0.2.3,
Pulse lists each question the trust layer checked on its way to Research and each web answer, with what was taken out marked
word by word, §7.27; owner, 2026-10-19), What
stays private (the twelve kinds with their defaults), Links in the app (every link in a reply
names the site it opens, and shows the real one when the words name a different site, §7.8;
owner, 2026-10-15), What goes to Claude (what an agent reads for a job goes to Claude through the owner's plan or
key; Pete runs only on Claude; at 0.2.3 Claude is the only engine the app offers), and Where your
data lives (kept on the computer, passwords encrypted under a key the system keeps). Every sentence holds on Mac and Windows and for every
engine, and the page states no limit notes: a privacy sentence says what the app gives, tells or
passes through the app and its trust layer, never that something can't happen where the app can't
enforce it (Windows has no sandbox, so a member's shell is not held there; owner, 2026-10-20). Send
only says a teammate isn't given the watched inbox to read. The same rule covers the home page's
hero, meta, JSON-LD, FAQ and privacy section (§9.15) and llms.txt. Headings sit
closer to their text than to the section above; the page never scrolls sideways at 320 px.
### 9.17 Pulse (web)

A home page section right after the file tabs (§9.14) and before the "Everything else" tiles
(owner, 2026-10-19, site design review): eyebrow "Pulse", heading "See what the office got
done, and what it cost.", lead "A Pulse tab beside Tasks shows the week: what each team member
did, what it cost, and ways to save that wait for your Apply. Here it is on Friday afternoon."
A read only picture of Pulse (§7.27) in the story's cast for This week, Compare off: the
header ("Pulse" 18/24 600, the period select reading This week, the Compare switch off,
"Collecting since" in `t-meta` `ink-3`); one recommendation card in the app's own words (Run Kelly's "check the support inbox" less
often / It found nothing to do on 258 of 312 runs. Every 1h to every 2h., the hourly job the
story's Kelly runs, a `green` soft "Saves about $3.90 a week" chip at API prices as the app shows it, and Not now
with an `ink` Apply kept together on one line); the scene is Friday afternoon of the week whose
plan use resets Mon, Nov 2, late enough for the app to show advice; at the top of Recommendations the Company foundations
strip (§7.27) as a `card` row, "Foundations" in `ink-3` with its (i), then Finance 3/5 and Sales
4/6, most hit first, each pill drawn, not a button (Finance's empty Financial year is the Setup
card's question, §9.18); then twelve tiles in §7.27's order, four to a row,
every one above zero so no quiet chip is drawn: emails organized, emails sent for you, tasks
finished, scheduled checks, questions to the internet, web answers cleaned, messages held
(`amber` soft, "See what was held" drawn, not a link), steps blocked by your settings, what
the team learned, questions to you, Spent with plan use (a Claude Max 20x price; Spent is
the plan's real cost for Monday to Friday afternoon by the app's own formula, §7.27) and your
time; then Team at work with six rows, busiest first, Oscar and Dwight each with the 12 px
`indigo` ring and "Foundations 3 of 5" and "Foundations 4 of 6" in `ink-3` 11 px under the role
(hidden with the roles on phones), the team average dashed, Busiest and
Quiet callouts, hours and cost. Tokens as the board's picture (§9.13): a `card-2` frame,
`r-2xl`, `shadow-lg`, padding 18; tiles `card`, `r-lg`, `shadow-sm` with a 1 px `line`,
padding 12/14; numbers IBM Plex Mono 28/32 600 (24/28 on the last four); who did it bars in
each member's department `acc`. Its CSS is its own block with a `pl-` prefix: it reuses no
board or file tab class. Coral is never used. Under the frame, three plain notes: Ways to
save (each looks at the last 14 days, comes with the numbers behind it and changes nothing until you click Apply; Undo
puts it back; on a Claude plan the saving is counted at pay per use prices and frees plan
use; advice starts two weeks after Pulse starts recording, and before that an Early look shows any
patterns it already sees), Compare (this
week beside last week, counted up to the same day, once there is a week before to compare), Real costs (on a Claude plan, what you pay
for the plan split by each member's share of the work). The frame is one `role="img"` whose
label carries every number and name in reading order; nothing in it can be clicked. As the app
draws them: the held tile's icon square `card` with `amber-text`; the Quiet callout `neutral-soft`
with `ink-3` and the Busiest callout `card` with `ink` and an inset 1 px `line-2` ring; from 480 px, where the chip
shows, the quiet row's avatar and name at 70% (its role keeps full `ink-3`, so it stays readable), and its hours, in
`ink`, at 70% from 760 px; legend dots 7 px with a 1 px `line` ring and
counts in `ink-2`; the plan use percent in IBM Plex Mono 12/600 `ink` and the plan line 11/15
`ink-3`; roles and callouts 10 px. Trimmed on the web, deliberately (owner, 2026-10-19, ship
review): legend parts at zero, the See each question and See each answer links, the icons and
sublines on the learned and questions tiles, Your time's While you were away half (its share is
a sentence under Your time), the Team at work column heads and average footer, and the
recommendation's button order (Not now, then Apply), and the learned tile's See the notes link and its in all footer.
Questions to you counts at least one request per scheduled check and question to Pete. Four
tiles a row at 1100 px and up, two from 760 to 1099; under 760 two compact tiles a row (icon
and legend hidden, number, label and bar kept), Spent and Your time each across both columns,
the recommendation stacked, Team at work without roles and with hours over cost. Under 480 px
the Busiest and Quiet callouts are hidden and the frame's padding is 12. The section never
scrolls sideways, also at 320 px with a scrollbar.

### 9.18 Setup foundations inset (web)

Under the setup inset (§9.12), a second quiet inset with the same fill, inset line, radius and
padding, for what comes after setup (Company foundations, §7.27a): Michael's avatar, "Then the
team learns your business" (600, 14/20), two inline items with 16 px icons ("One question to you,
only when work needs the answer" and "Learns the rest from your answers and the team's work") and an
`ink-3` line under them. Beside the text, a read only picture of one foundation card (§7.27a) in
the story's cast, at the story's app scale: the question "Financial year" as its title; Oscar's
Finance raiser chip and "needs this, 2h ago" in `ink-3`; Michael's one bold evidence line, example
copy in the app's form ("Oscar set this quarter's sales tax reminder without knowing when your
financial year starts."); the visible "Your answer" label, an empty box and the hint under it ("A
few plain sentences, under 300 characters. For more, name the file that holds it."); Save answer
(primary), Have Oscar draft it (secondary) and Not now as a quiet text link at the line's end; and
the footer above a `line` rule, "Finance uses this" and "Asked weekly until answered". Oscar is in
every pack, so the card holds whatever business the visitor picks. The card is one picture with
one description (role=img): its buttons are drawn, and nothing in the inset can be clicked, as in
§9.12. No coral: the card waits on an answer, it is not Blocked. Its own `fd-` classes; no class
from another section. At 980 px and up the text and the card sit side by side, the card 380 px
wide; under that the card goes under the text, up to 420 px wide. Never scrolls sideways, also at
320 px with a scrollbar.

---

## 10. Iconography [Both]

- Outline icons, 1.75 px stroke at 16 px (1.5 at 14, 2 at 20), round caps and joins,
  `currentColor`. The Lucide set (ISC license) is the reference style; custom icons match
  it.
- Sizes: 14 (inline in meta), 16 (buttons, rows), 18 (top bar), 20 (empty states).
- Every icon only button has an `aria-label` and a tooltip.
- `file` (a document) and `sheet` (a spreadsheet or CSV) mark Ask me file rows (§7.8).
- `external` (opens the browser) and `mail` (opens the mail app) follow a named link in
  agent text, at 12 (§7.8).
- `lock` marks a choice that cannot be changed, at 12, with visible words beside it
  ("Always private", §7.26).
- `help` (a question in a circle) marks a state that could not be checked (§7.25); `info`
  opens an InfoTip explanation. Never swap them.
- `components/Icon.tsx` draws these outline icons; the v1 pixel set is retired (§17, row 6).

---

## 11. Motion

### 11.1 Tokens [Both]

| Token | Value | Use |
|---|---|---|
| `dur-fast` | 120 ms | Hover, press |
| `dur-base` | 200 ms | Panel swaps, menus, tab underline |
| `dur-slow` | 320 ms | Overlays, the right column changing state |
| `ease` | `cubic-bezier(.2,.7,.2,1)` | Everything that moves in or out |
| `pulse` | 1.6 s, opacity 1 to .35 | The Needs you dot, the live dot |
| `breathe` | 2.4 s, opacity 1 to .55 | Lit screens while working |
| `ring` | 1.8 s, scale .6 to 1.5, fade out | Needs you beacon |
| `burst` | 900 ms | Done check burst |
| `bump` | 700 ms, a small overshoot (`cubic-bezier(.3,1.6,.5,1)`) | The Needs you button catching a paper plane, and a new hire's pod dropping in: the two arrivals; everything else uses `ease` |

### 11.2 App [App]

Motion carries information or it doesn't happen: token travel, beacons, screens breathing,
the check burst, the quote bubble fade, and the rest of the stage's life (§8.12). UI chrome does not move on its own. The stage
pauses all animation when the window is hidden, in focus mode, or when another view is
showing (as today's floor does).

### 11.3 Reduced motion [Both]

With `prefers-reduced-motion: reduce`: no token travel (a token appears at its
destination for 1 s), no pulses or rings (static dot and static beacon), no breathing, no
quote bubbles, instant panel swaps. The web hero shows the still.

---

## 12. Accessibility [Both]

- Contrast: text 4.5:1 or better on every surface it can appear on; 3:1 for text 18.66 px
  bold and up; 3:1 for control boundaries (`line-input`) and focus indicators. The values in
  §3 are measured; keep them measured. Decorative lines (`line`, `line-2`) are not control
  boundaries.
- Focus: 2 px `indigo` (`#6C5CE7`, 4.9:1 on `card`) outline with 2 px offset on every
  interactive element, including pod label cards and graph nodes. Web: 3 px, 3 px offset.
- Keyboard: Tab reaches everything. On the stage, Tab enters the pods, arrow keys move
  between label cards in reading order, Enter selects, Esc returns focus to the board.
  Every overlay closes on Esc. Enter and Esc respect IME composition (`isComposingKey`).
- Never color alone (§2.3). Pills carry words; badges carry counts and words.
- Touch targets 44 px on the web's phone layout. In the desktop app, 28 px minimum.
- Dialogs: `role=dialog`, `aria-modal`, labelled, focus trapped and restored.
- `dir=auto` on user and agent authored text; bidi isolates around paths and addresses.

---

## 13. Voice and copy [Both]

### 13.1 Shared rules

- Activity captions are office words, never engine words (owner, 2026-09-30). `actionText`
  turns tool calls and engine states into plain phrases on every card, panel header and
  closing time row: Bash is "Running a task on the computer", Read "Reading a file",
  WebSearch "Searching the web", mail tools "Checking email" or "Sending an email", a
  connected app "Working in HubSpot", anything unknown "Working"; "compacting context" is
  "Organizing their notes". The stored action does not change.

- Name the actor. "Oscar is matching September payments", never "the agent is processing".
- Keep system feedback under 12 words. Second person to the owner.
- Fields first; explanations behind an info icon, short.
- No emoji in UI copy.
- Exclamation marks only for completions.
- Real punctuation: "don't", never "dont".
- **No em dashes, en dashes, or hyphens used as dashes in user-facing copy.** Use a period,
  a comma, a colon or parentheses.

### 13.2 App tone

Plain and factual, owner words, not developer words (no "MCP", "PTY", "tokens",
"runtime"). Michael speaks in the first person on his cards ("I can't approve money").
Office humor only where nothing needs doing: idle quotes, empty states, the booting
caption.

| Don't | Do |
|---|---|
| "An error has occurred" | "Oscar hit a snag" |
| "Permission denied" | "Oscar needs your OK" |
| "Task blocked on human input" | "Waiting for you" |
| "Loading..." | "One sec..." |

### 13.3 Web tone

Dry and confident. The joke is on Michael, never the customer. Headlines are sentence case
statements that land on one line when they can. Claims stay honest: a download button only
points at a real release.

---

## 14. Token files

| Surface | File | Holds |
|---|---|---|
| Kit | `branding/colors/colors.{css,json}`, `dont-be-michael.ase`, `palette.png` | Every §3 token, light and dark, generated by `source/build.py`. Do not hand edit |
| App | `src/renderer/src/design/tokens.css` | `--cth-*` custom properties with the same names after the prefix as the kit (`--cth-ink-3` = kit `--dbm-ink-3`); light in `:root`, dark under `:root[data-cth-theme='dark']` |
| App | `src/renderer/src/design/tokens.ts` | TS mirror for the SVG stage and inline styles. Changes with `tokens.css` in the same commit |
| Web | `public/assets/site.css` `:root` | `--dbm-*` copied from the kit's `colors.css` (light values only) |

Rules:

- Change §3 here, then `source/build.py`, then run it; then the app and site files.
- A token that exists on one surface only says so in a comment.
- **[Web]** Any edit to `site.css` bumps the `?v=` query in `index.html` and `404.html`.

---

## 15. Themes

- **[App]** Light and dark, one token swap. The terminal follows the switch as today.
  Dark is lifted: the ground is `#14131C`, never `#000`; text is `#ECEAF4`, never `#FFF`.
- **[App]** The TV show office themes (`OfficeThemePicker`) are retired with the floor.
- **[Web]** Light only. The brand's first impression is the light studio.

---

## 16. Making changes

1. Decide at the right level. If it changes what a color, face or shape *means*, it is a
   brand change (§1 to §4, §8) and is decided for both surfaces at once.
2. Edit this file, then `source/build.py` and the token files, then components.
3. Before merging a visual change, check the app at 1280 × 800 and 1440 × 900 in both
   themes and in Arabic, and the web at the §5.3 widths.
4. Record deliberate deviations in §17 with a reason, or remove them.
5. Add a line to §18.

---

## 17. Migration and debt register

v2 is adopted in the spec, the kit and the app (phases 1 to 6, the studio life work and the
Needs you rework on `design/studio-v2`, through 2026-10-01). Each row is **Fix**
(the spec wins), **Accepted** (with a reason) or **Done**.

| # | Surface | Gap | Where | Status |
|---|---|---|---|---|
| 1 | App | Pixel office floor (Pixi.js) is the main view | `src/renderer/src/scene/office/` | Done: `scene/studio/`; the Pixi files, tilesets and maps are deleted (`cast.ts` and `cafeteriaLines.ts` remain, as data; `props.tsx`, added 2026-10-03, draws the props of §3.4) |
| 2 | App | Bottom agent strip and right Command Center layout | `AgentStrip`, `AgentCard`, `CommandCenterPanel`, `App.tsx` | Done: `shell/`; strip and card deleted |
| 3 | App | Pixel primitives and pixel fonts | `PixelPanel`, `PixelButton`, `PixelBadge`, `fonts.css`, `tokens.css` | Done; Press Start 2P removed with the floor |
| 4 | App | Tokens are the v1 cream and ink palette | `design/tokens.css`, `tokens.ts` | Done |
| 5 | App | Ask me is a tab in Michael's panel | `AskMeTab`, `CommandCenterPanel` | Done |
| 6 | App | Pixel icon set | `components/Icon.tsx` | Done: outline icons behind the same component |
| 7 | App | Settings and onboarding dialogs lack `role=dialog`, focus trap and Esc | `SettingsModal`, `OnboardingWizard` | Done: `shell/Dialog.tsx` and `useDialog` for Settings, hire, edit, quit and closing time; Esc reaches only the top dialog |
| 8 | App | Task detail has no Esc handler | `TaskDetailOverlay` | Done |
| 9 | App | Role to department mapping does not exist | `src/shared/officeRoles.ts` | Done: `departmentOf` in `src/shared/officeRoles.ts`, which `scene/studio/layout.ts` and Company foundations share |
| 10 | App | No counters for delegated and kept | hive | Done: counted from the hive log and tasks, shown on Michael's wall sign and hub card |
| 11 | App | UI strings not audited for dashes | `src/renderer/src/i18n` | Done: `test/no-dashes.test.cjs`; ALL CAPS strings moved to sentence case (§4) |
| 12 | App | Reference screens use 9 to 9.5 px text and off-grid spacing | `reference/studio/` | Done: re-shot from the build (#25) |
| 13 | App | Reference screens predate the contrast fixes (`ink-3`, pill text, coral fills) | `reference/studio/` | Done: re-shot from the build (#25) |
| 14 | Kit | Retired fonts still in `fonts/` | `branding/fonts/` | Done: VT323, Pixelify Sans, Press Start 2P and Inter removed (2026-10-01); the site repo keeps its own copies |
| 15 | Web | Whole site is v1 (arcade palette, pixel type, hard shadows, chunky frames) | site repo `public/` | Fix: §9 |
| 16 | Web | Hero shows the pixel office video | site repo | Fix: §8.11 still (the app repo's copy of the video is removed) |
| 17 | Both | README and screenshots show the pixel floor | `README.md`, `docs/media/`, `docs/screenshots/` | Done (2026-10-01): the README shows the reference screens (§20); the old project's videos and screenshots are removed; new demo videos are a TODO |
| 18 | App | Release notes modal paints its own palette | `ReleaseDrop.tsx`, `shared/releaseDrop.ts` | Done (2026-10-01): the frame uses the v2 palette and Sora; the older token names still resolve for drops written against the site palette |
| 20 | App | Agent strip removed (phase 2); its per-card functions move with later phases: context gauge, sticky task count and typing dot to the pod label card (§7.14), private note to the person panel header (§7.10), drag to reorder to Michael's Advanced roster | `AgentStrip.tsx` | Done: gauge and task count on the pod card, note in the panel header. Reorder lives in the focus mode roster, which is hidden (#24) |
| 21 | Both | Reference screens show "closes 6:00 PM"; the app has no office hours | `reference/studio/` | Done: re-shot from the build (#25) |
| 19 | App | The title bar imports the kit lockup, so it already shows the v2 Sora wordmark inside the v1 app | `App.tsx` (`@brandkit/logo/lockup`) | Accepted: it is v2 and needs no change; the rest of the top bar follows with #2 |
| 22 | App | `pixi.js` stays in `package.json` though nothing imports it | `package.json` | Done (2026-10-01): removed from `package.json` and the lock (npm 10) |
| 23 | Both | README still credits LimeZu art the app no longer ships | `README.md`, `LICENSE-ASSETS` | Done (2026-10-01): the credit, the asset licence block and `LICENSE-ASSETS` are gone; no third party art ships |
| 24 | App | Focus mode is hidden (`SHOW_FOCUS_MODE`), so drag to reorder people has no visible home | `FullscreenTerminal` | Accepted: the order is kept; give reorder a home if it is missed |
| 25 | Both | Reference screens (§20) predate 2026-09-30 and 10-01: cards on every pod, the hub card and M badge, the old Ask me cards, the solid right column, Brief Michael | `reference/studio/`, the brand guide | Done: re-shot 2026-10-01 with `npm run shoot` (§20); brand guide, PDF and social card rebuilt |
| 26 | App | Ask me can no longer be dismissed; older dismissed entries still read as closed | `AskMeTab`, `shared/askMeRouting.ts` | Done (owner, 2026-10-01: an ask is handled with a response) |

---

## 18. Change log

| Date | Change |
|---|---|
| 2026-10-03 | Floor character: each person is drawn as their character's prop, and each department has a line icon (§3.4, §7.10, §7.14, §7.17); desks carry their person's prop, and the floor has plants and a water cooler (§8.3); the ring holds up to 9 pods, operations and team included (§8.9); banter goes to a partner who would say it (§8.8). The right column shows on the Office view only (§7.6). No pack caption beside Hire (§7.19). Tasks view: a Waiting column that only Michael sets (§7.20, §7.21). Who talks to whom: a time range instead of the last 200 messages, people as their props, no Topics (§7.22). |
| 2026-10-03 | Tasks view: the dismiss `x` closes a card as Done by the owner's decision ("Closed by owner"), never deletes it; "With Michael", "Michael hasn't moved this" and "Nothing asked" on cards; Task detail's status offers To do, Doing and Done (§7.20, §7.21). |
| 2026-10-05 | Web: platform switch, Beta tag and install dialog drawings for the download page (§9.8 to §9.10). |
| 2026-10-05 | Top bar: the Beta pill also sits beside the version, its InfoTip pointing to Report a problem in Settings. |
| 2026-10-05 | Settings: a Beta pill (with an InfoTip) beside the version on every build, and Report a problem opens a bug report with the app version and OS filled in (docs/designs/windows-11-installer.md, E4). |
| 2026-10-05 | Send on approval: mail approval cards on Ask me (§7.8); a third Sending choice and Sends without asking, with Revoke, on the Access tab (§7.12). |
| 2026-10-06 | Michael's conversation dock above the Talk to Michael composer, whose one count replaces the queue chip (§7.19); Report cards on Ask me and the quiet "Reports: N" pill (§7.5, §7.8). |
| 2026-10-07 | Access tab, Email: no switch; one row per address used with Inbox and Sending lines, and Add a mailbox with Watch the inbox or Send only (§7.12). Settings, Mailboxes names who else sends from a mailbox (§7.26). |
| 2026-10-07 | Onboarding: the card is centered while the studio isn't showing and glides to its column when it appears, the background glow following it (§7.25); onboarding reference screens re-shot. |
| 2026-10-07 | Onboarding: a Ready step (Get Michael ready) installs Claude Code and signs the owner in where they can see it; skipped, Ask me keeps a card (§7.25). |
| 2026-10-10 | Files named in replies and Ask me cards are chips in place of their path (plain full paths too); Open shows Markdown, text, JSON, CSV and images in a closable file tab after Who talks to whom, at most 5, live, with Ask me beside it; PDF and Office files open in their app (§7.2, §7.8, §7.19). |
| 2026-10-10 | The owner's message to Michael flies as a paper plane in the owner's indigo, not an envelope; it lands at his office with the two rings (§8.8, §8.12). |
| 2026-10-09 | Web, Windows first class: the platform switch drops the Beta tag (§9.8, §9.9 retired for web); the Windows note is a lead line plus bullets; the home page gets the Sending switch with the mail approval card (§9.11), the setup inset (§9.12) and six "Everything else" tiles (§9.5); the social card says "on your computer" (§9.7). |
| 2026-10-10 | Panel tabs: the mouse wheel scrolls an overflowing tab row sideways, and an edge fades while tabs are hidden past it (§7.11). |
| 2026-10-12 | Web: the home page's task board after the refund story, the Tasks view (§7.20) as a read only picture that leads with Blocked and Waiting on small screens (§9.13). |
| 2026-10-12 | Web: file tabs after the task board, a CSV open in a file tab (§7.2) from a chip on Oscar's Ask me card (§7.8), the card beside it, as a read only picture (§9.14). |
| 2026-10-12 | Named links in agent text: a pasted URL on a card shows the app or site it opens, with an `external` or `mail` icon, a hidden screen reader phrase, and the real site in `ink-3` when the words name another one (§7.8, §10). |
| 2026-10-12 | Ask me: the See full context footer shows only when the card has a background, a result or other questions and answers (§7.8). |
| 2026-10-12 | Task detail: QUESTIONS newest first, each with how long ago it was asked (§7.21). |
| 2026-10-12 | Office stops: out of credit and a sign in that stopped working join the plan limit break, as a counted owner to do with a coral chip; the plan limit stays the quiet amber break (§7.6a). |
| 2026-10-13 | Pete joins the idle talk (§8.8): his own lines and bits from his season 9 story, and a first day welcome once per turn on, per office (owner, D1, D5, D7, D9). |
| 2026-10-13 | Research & privacy (issue #230): a Settings section with the Research row and the data classes (§7.26), Research in the onboarding Team step (§7.25), the one time Research report card (§7.8); the Sites group is gone from the Access tab (§7.12). |
| 2026-10-13 | The Research team member is called Pete (owner): the Settings copy, the Team step row and the report card name him (§7.8, §7.25, §7.26); his name and engine show as plain text in Edit agent. |
| 2026-10-13 | The Research member is renamable, Pete by default, and the copy takes its current name; Research & privacy shows in every office (owner, ship 2 D16, ship 2 D17). |
| 2026-10-13 | Research wears Pete, its own character (magnifier over a globe), not Ryan, who stays Marketing's (owner, third ship D4, §3.4, §7.25); the crash screen (§7.25a) and the `lock` icon (§10) are written down. |
| 2026-10-14 | Tasks view: search box matching waiting on and member names, team member filter with Unassigned, clickable status count chips with `aria-pressed`, "Showing X of Y", and "No tasks match your search or filters" (§7.20). |
| 2026-10-04 | Banter flies as paper planes only; an envelope on the floor is always a real message (§8.8, §8.12). |
| 2026-10-04 | Ask me file rows: a question's named files open from the card, or show in Finder (§7.8); `file` and `sheet` icons (§10). |
| 2026-10-01 | Pre-landing review fixes: dialogs close when closing time starts and its bar sits above them; the compact grid stays clear of the right column; selecting someone dims the rest of the stage to 45% (§7.14); Traces behind a flag (§7.11); setup screens on v2 fields and rows (§7.25); the composer keeps its width and takes pastes (§7.19); Settings and closing time copy in plain words. |
| 2026-10-01 | In repo register items closed (§17): retired kit fonts and `pixi.js` removed, the README shows the reference screens with no LimeZu credit, the release notes frame on v2. Five more reference screens (§20). Settings and setup copy in sentence case. |
| 2026-10-01 | The Ask me answer box and the Talk to Michael box grow with the text (§7.8, §7.19). |
| 2026-10-01 | Task detail: title under the id row, the card's notes shown, no empty section (§7.21). |
| 2026-10-01 | Ask me titles read plain: agents are told how to title a card, and the card drops opaque ids and bracketed metadata (§7.8). |
| 2026-10-01 | Every quiet pod chip sits just over its pod, the right and front pods too; a quiet pod's card rolls down in its chip's place (§7.14a). |
| 2026-10-01 | Idle lines: only the Office lines in `cafeteriaLines.ts`, dealt with no repeats until a pool runs out; banter, two quiet people trading an exchange as paper planes or envelopes, each line shown where it lands; every 15 to 30 s (§8.8). |
| 2026-10-01 | The Tasks tab drops its blocked count; Needs you is the one coral number (§7.2). |
| 2026-10-01 | Reference screens re-shot from the app's components (`npm run shoot`, §20); brand guide, PDF and social card rebuilt. Found while shooting: pod cards above their pod no longer run under the top bar on a short window (§7.14); graph nodes stay clear of the toolbar and legend (§7.22); the setup footer sticks to the window and its buttons read Back and Next (§7.25); the not picked tag moves to its outline's back corner. |
| 2026-10-01 | Needs you: no dismiss (an ask is cleared only by answering), "See full context" replaces "Open task", a chevron shows each card opens. Focus mode hidden (`SHOW_FOCUS_MODE`). The studio lab (§8.13) for demos and videos. |
| 2026-09-30 | Studio refinements after the first build: quiet pods show a chip (§7.14a); the office's life (§8.12) with no standing wires (§8.6); lights come up as people clock in and go out at closing time, which is a bar on the floor, not a dialog (§7.23); Michael's numbers on his walls, a name plate on his door that opens his card (§7.17, §8.4); idle quotes belong to the chip (§8.8); captions in office words (§13.1); Ask me cards fold, one open at a time, straight on the stage (§7.8, §5.2); "Talk to Michael" (§7.19); one dialog frame (§7.23); outline icons (§10). |
| 2026-09-30 | **v2 Studio adopted.** Pixel floor, bottom strip, Command Center layout, pixel UI, pixel type and the arcade web palette retired. One token set for app and web (§1.3). Sora and IBM Plex Mono replace Inter, VT323, Press Start 2P and Pixelify Sans. Wordmark in Sora; the Struck M mark kept. Studio illustration system (§8). Contrast corrected against the mockups: `ink-3` `#6C6884`, accent text colors, `coral-strong` for coral fills with text, `line-input` for control boundaries. v1 archived at `archive/DESIGN-v1-pixel.md`. Decisions and the functional map: `docs/designs/studio-home.md`. |
| 2026-09-28 | (v1) Web: Pro offering removed; nav cut to four links plus Download. |
| 2026-09-24 | (v1) One spec for app and web, moved into `branding/` with the brand kit. |
| 2026-10-14 | Web: the privacy section after the Sending block, a Privacy first badge, a three position trust layer switch with the app's Privacy check notes and Pete's labelled answer, and Settings, Research & privacy as a read only picture; Pete's globe avatar; the /security page to read (§9.15, §9.16). |
| 2026-10-15 | Web: the Files notes swap the five tab limit for what the office reads (Excel exports from accounting and payroll software, long PDFs, PowerPoint decks), PDF and Office opening joins the first note (§9.14); `/security` gains a Links in the app section (§9.16) (owner, 2026-10-15). |
| 2026-10-14 | Edit agent: a Danger zone under the engine with Delete, for anyone but Michael, his assistant and Pete; the one card besides Settings' Danger zone with the coral ring (§6.3, §7.26). |
| 2026-10-15 | Ask me: options as rows to pick, with a Recommended tag, and several questions with a line each; picking never sends, Reply on its own row says what it sends, and any question may be left blank (§7.8). |
| 2026-10-15 | Pulse, a view tab between Tasks and Who talks to whom that takes the whole window: recommendations, what got done, Kept safe, the row of four tiles, Team at work, and trends on Last 4 weeks (§5.2, §7.2, §7.6, §7.27). |
| 2026-10-16 | Pulse: periods Today, This week, This month, and Compare, two bars per tile against the span before up to the same day, the switch kept in place while a period cannot compare yet; Last week and Last 4 weeks go (§7.27). |
| 2026-10-17 | Not reporting (§7.6b): a card on Needs you when a team member's engine stops reporting to the app, one per engine version, with Restart, Change engine and Keep working unchecked; an amber Not reporting tag on its pod and panel; the office's own card for Michael. §6.3 drops the stale coral left rule on Ask me cards (§7.8 has none since 2026-09-30). |
| 2026-10-17 | Tasks board: time group headings in each open lane (Overdue to No date, §7.20). |
| 2026-10-17 | Tasks board: open columns read earliest Next first, no Next after, ties by priority then the order made; the Next line shows the year when it is not this year (§7.20, §7.21). |
| 2026-10-17 | Wide 1:1: Open wide moves the conversation with Michael and its box to the center, beside the right column and never over it; its own remembered choice; `t-read`, no fold and content sized tables while wide; Esc to the side, then close; one thing in the center, last opened wins (§4.2, §7.6, §7.19). |
| 2026-10-18 | Office opening: the Clocking in card is the one colored card on the floor (indigo, `t-view` title, a bar, who is still coming), ends with "Everyone's in" or who has not clocked in at the cap, runs only from launch or a Restore team, and Michael's own start shares it; the clock pill says "Opening" and the count meanwhile; the screen reader hears start and end only (§7.3, §7.24). |
| 2026-10-18 | Michael's wall and hub card count Waiting: five columns in the Tasks view's order (To do, Doing, Waiting, Blocked, Done), Waiting in `amber`; the hub card is 212 px so the five labels never touch (§7.17, §8.4). |
| 2026-10-18 | Pulse, Kept safe: each tile names its number in a few words, the same at zero, with its own (i); shorter legend and gate names; a tile's legend shows only once a part is above zero (§7.27). |
| 2026-10-19 | Pulse shows only tiles with something to say: one grid in a fixed order, quiet tiles as chips in one row that open their tile, Spent always; members with no working time fold into one row; Recommendations before advice is one `ink-3` line (§7.27). |
| 2026-10-19 | Pulse, before two weeks: Early look insight cards take the one line's place when the advice rules already see something (§7.27). Company knowledge in Settings, Memory & Knowledge: no switch, a Documents list with Open, search by meaning inside the same block and no Semantic memory section (§7.26). Company foundations: the strip, the count and the member detail box on Pulse (§7.27), the foundation card and the one time Company knowledge is always on card on Needs you (§7.27a). A file named without its ending is a chip when the office's folders hold it (§7.8). |
| 2026-10-16 | Wide panel: a person's or Michael's panel, and Edit agent over it, open wide in the center of the window with the office dimmed under the top bar; Edit wide in two columns with "Edit {name}"; unsaved changes ask before any way out; `t-read` 14 / 22 (§4.2, §5.2, §7.6). The right column drag reads as built: 420 default, 320 to 1200 (§5.2). |
| 2026-10-15 | Studio: a department plate on each pod's pad ("HR" for people), so the pod says what it does (§7.14, §8.3); every monitor, Michael's too, is frameless glass, clear when idle and tinted in `acc` with scrolling lines at work (§3.4, §3.5, §8.3, §8.5); `home-light` and `home-dark` re-shot (§20). |
| 2026-10-20 | Web: Pulse (web) catches up with 0.2.4: the Company foundations strip at the top of Recommendations (Finance 3/5, Sales 4/6), Foundations counts under Oscar's and Dwight's roles on Team at work, and the Ways to save note says an Early look shows any patterns Pulse already sees before advice starts (§9.17). |
| 2026-10-20 | Web: Setup foundations inset (§9.18), a second Setup inset after Then Michael gets ready: Then the team learns your business, with a read only foundation card (§7.27a) for Oscar's Financial year question, its buttons drawn, nothing clickable. |
| 2026-10-20 | Web: privacy wording that holds on Windows: Pete does the team's web research and the rest of the team is told to ask Pete; the app turns off the web tools for everyone else, gives Pete questions only, and the trust layer checks what passes through it both ways; /security's first section is Who is given what; data kept on the computer (§9.15, §9.16). |
| 2026-10-19 | Web: Pulse (web), a read only picture of Pulse after the file tabs with three notes (§9.17); the Ask Michael tile names picking Michael's choices with a click (§9.5); the board's Waiting note names Michael asking whether to keep waiting (§9.13); /security names the memory wall and Pulse's lists, and who is told when a message is held (§9.16); the file tabs picture shows the Pulse tab (§9.14). |

---

## 19. Open decisions

1. **Today timeline** (Day Lanes). Designed as a later view; not in the first v2 release.
2. **Operations and team colors** (§3.4) have no reference screen yet. Confirm when a pack
   with Supply Chain or Quality is shown.
3. **Web hero loop.** Still image first; a loop can be recorded from the studio lab (§8.13).
4. **Settings and hire wizard screens** have no v2 reference screens; they follow the
   components. Design them if the restyle raises questions.

---

## 20. Reference screens

In `reference/studio/` (PNG, 1440 × 900); the README uses them too. First approved as mockups 2026-09-30; re-shot
2026-10-01 from the app's own components on the fictional Harbor & Pine office, so they show
the build as it is. `npm run shoot` re-shoots them all (or `npm run shoot -- home-dark` for
one) from `tools/studio-lab/reference.tsx`, with the clock fixed at 10:42 and a seeded
random, so a re-shoot changes only what the app changed. `home-light`, `home-dark`,
`tasks-detail` and `who-talks-to-whom` were re-shot 2026-10-03, and `home-light` and
`home-dark` again 2026-10-15 (department plates, glass monitors). Then
`python3 branding/source/build.py social guide` rebuilds the social card and the brand
guide PDF, which use them. Re-shoot after any visible change to these screens.

| File | Shows |
|---|---|
| `home-light.png` | Office view, Needs you board, light |
| `home-dark.png` | The same, dark |
| `kelly-access.png` | A person selected, Access tab (Email, Claude connectors, On a schedule) |
| `kelly-work.png` | A person selected, Work tab (her session, Talk 1:1) |
| `michael-office-schedule.png` | Michael selected, Office schedule tab |
| `tasks-detail.png` | Tasks view with a task detail open |
| `who-talks-to-whom.png` | Who talks to whom |
| `onboarding-team.png` | Onboarding step 4, Your team, Pro Services pack |
| `onboarding-business.png` | Onboarding step 1, Your business |
| `onboarding-meet.png` | Onboarding step 3, Meet your office |
| `onboarding-ready.png` | Onboarding step 8, Get Michael ready (installed, not signed in) |
| `kelly-memory.png` | A person selected, Memory tab |
| `hire.png` | The hire wizard, step 1 (Who) |
| `settings-autonomy.png` | Settings, Agents (the default model, autonomy and the circuit breaker) |

The original mockups (HTML and generators) live with the design session in
`~/.gstack/projects/agentvivekkumar-dontbemichael/designs/business-first-redesign-20260930/`.
