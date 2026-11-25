# Pastry Neon theme: plan

- **Date:** 2026-11-24
- **Status:** Proposal. Awaiting approval. Nothing is built yet.
- **Visual preview:** [`assets/pastry-neon-theme-preview.html`](assets/pastry-neon-theme-preview.html). Open it in a browser to see the mockups.
- **Source:** Pastry Marketing logo and the "Guess what's coming" promo poster.
  Also the "Account Boosters Technology is now Pastry" announcement poster.

## Goal

Replace Marshmallow's generic blue and purple look with a theme taken from the Pastry
Marketing brand. Pilot it on the screens changed in November 2026, then roll it out to the
whole CRM after Sir approves.

## Palette

Lime and pink are the two brand voices. Lime means "go / do this". Pink means
"look here / urgent". Status colours keep their usual meaning: red for critical, amber for
needs action, green for resolved.

Booster cyan and Booster violet come from Account Boosters Technology, Pastry's previous
name (the rocket logo and the logo's slice stripe), so the CRM keeps a link to the old brand.

| Token          | Dark      | Light     | Use                                                          |
| -------------- | --------- | --------- | ------------------------------------------------------------ |
| Ink / Paper    | `#0A0A20` | `#F6F7FC` | Page background                                              |
| Night / White  | `#13143A` | `#FFFFFF` | Cards, panels, sidebar                                       |
| Action         | `#D6F51B` | `#14143F` | Main buttons. Text on it: Ink 15.7:1 / lime 14.1:1.          |
| Pink           | `#FF2D8F` | `#C0106A` | Focus rings, urgent text and counts                          |
| Pink fill      | `#E0147A` | `#C0106A` | Solid urgent labels with white text (4.6:1 / 6.0:1)          |
| Booster cyan   | `#22C8E8` | `#0E7490` | Info, links, Quo, schedules                                  |
| Booster violet | `#B57BFF` | `#6D28D9` | AI status and automation only                                |
| Sun            | `#FFC83D` | `#9A5B00` | Warning, needs action (light value is the text colour)       |
| Cherry         | `#FF4B5C` | `#C81E3A` | Critical alerts and errors only                              |
| Mint           | `#6EE7B7` | `#047857` | Resolved, success                                            |
| Haze           | `#A6A9D6` | `#5B5E8A` | Secondary text, timestamps                                   |

**Contrast:** every text pairing above was measured at WCAG AA (4.5:1) or better.
White on `#FF2D8F` is only 3.5:1, so solid pink labels use the deeper pink fill.

**Light mode:** lime is too pale for text on white. Light mode uses navy buttons with lime
text and deeper pink, cyan and violet for text. The login art and page hero stay dark in
both modes. The preview has an Auto / Light / Dark switch to compare them.

**Slice stripe:** the logo's four bands (pink `#FF2D8F`, violet `#A646F0`, sun `#FFC83D`,
cyan `#22C8E8`) are used only as a thin 4 to 5px band: under the top bar, on the login art
and in the sidebar logo. Never as a fill behind text.

**Quo chip:** Quo (formerly OpenPhone) uses black with "citric yellow" `#EDFC47` and a
plain "QUO" wordmark. The Quo chip uses exactly that, black with a citric-yellow wordmark
(18.6:1), in both modes. It is never a yellow fill, so it can't be mistaken for a lime
action button. Quo's colours are used only on the Quo chip.

## Components and status

- **Icons:** the Lucide set the CRM already uses, always next to a text label.
- **Buttons:** primary (one per screen), secondary, ghost, pink for urgent actions, cherry
  for destructive actions (always confirmed), icon-only with an accessible name, and a
  loading state that keeps its label and blocks double clicks.
- **Fields:** default, focus (pink ring), error (cherry border plus message) and read only.
- **Severity:** the four levels from `src/lib/notification-severity.ts` keep their icons and
  labels, now in theme colours: Critical = cherry, Needs action = sun, Resolved = mint,
  Info = Booster cyan (instead of sky blue).
- **Priority and approvals:** Urgent Job is the only tilted sticker. Pending approval is
  sun, Approved is mint, Rejected is cherry. AI checks are violet and advisory only.

**Already in code:** `--pastry-navy`, `--pastry-pink`, `--pastry-lime` and
`--pastry-cherry` exist in `src/index.css` and `tailwind.config.ts`. They are used on the
login screens only, on branch `feat/login-pastry-brand-theme`. The pilot would add the neon
values above as theme tokens.

## Type

- **Display:** Anton, heavy condensed capitals. Used only for page titles, big counts and
  the login headline.
- **Body:** Inter, unchanged. Tables, notes and forms stay as they are.

## Signature details

Each detail has a fixed place, so the CRM stays calm to work in.

1. **Pink sticker:** a slightly tilted pink label, only for Urgent Job and the urgent count.
2. **Lime slash underline:** under page titles.
3. **Halftone dots:** in empty corners of the login and page headers. Never behind text.
4. **Light rays:** on the login panel only.
5. **Slice stripe:** the four-band stripe from the logo, in three fixed places only.

## Pilot screens

These screens were changed in this round (PRs #81 to #86 and the login branch):

- Login, including the two-factor and access-code screens
- Leads: the Urgent leads table and the lead cards
- Lead notes: Processor Notes and CS Notes
- Processor Board
- Notifications: the bell dropdown and the page
- Sidebar

## Rollout

1. **Approve this plan.** Sir signs off on the colours, the font and the details, or asks
   for changes.
2. **Build the pilot.**
   - A "Pastry theme (pilot)" switch in the user menu.
   - It applies only to the pilot screens.
   - Colours come from shared theme tokens (an override on `--primary`, `--ring`,
     `--background`, `--card` and similar), so no component is repainted by hand.
3. **Try it for a week.** Pilot users work in it day to day. Collect anything that reads
   badly or feels too loud, and adjust.
4. **Roll out to all.**
   - Make it the default for every page and role.
   - Remove the switch.
   - Match Donut, the extension, in a separate versioned release
     (`npm run extension:release`).

## Guardrails

- Display only. No data, permissions, approvals or workflows change.
- Status colours keep their meaning (critical, needs action, resolved), and every status
  also has a text label or icon.
- Contrast is checked to WCAG AA in dark and light mode.
- Decorative motion respects reduced-motion settings.

## Decisions needed from Sir

1. **Headline font:** use Anton (free Google font, one small extra download)?
   - Recommended: yes.
   - Alternative: Inter Extra Bold everywhere. Safer, but less like the poster.
2. **Who gets the pilot:**
   - Recommended: Admins and CS Admins in week 1, then everyone in week 2.
3. **Default look after rollout:** open the CRM in dark mode by default?
   - Recommended: yes. Light mode stays one click away.
