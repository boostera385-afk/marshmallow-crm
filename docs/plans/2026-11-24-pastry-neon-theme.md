# Pastry Neon theme: plan

- **Date:** 2026-11-24
- **Status:** Proposal. Awaiting approval. Nothing is built yet.
- **Visual preview:** [`assets/pastry-neon-theme-preview.html`](assets/pastry-neon-theme-preview.html). Open it in a browser to see the mockups.
- **Source:** Pastry Marketing logo and the "Guess what's coming" promo poster.

## Goal

Replace Marshmallow's generic blue and purple look with a theme taken from the Pastry
Marketing brand. Pilot it on the screens changed in November 2026, then roll it out to the
whole CRM after Sir approves.

## Palette

Lime and pink are the two brand voices. Lime means "go / do this". Pink means
"look here / urgent". Status colours keep their usual meaning: red for critical, amber for
needs action, green for resolved.

| Token  | Hex       | Use                                                                    |
| ------ | --------- | ---------------------------------------------------------------------- |
| Ink    | `#0A0A20` | Page background                                                        |
| Night  | `#13143A` | Cards, panels, sidebar                                                 |
| Lime   | `#D6F51B` | Main buttons, active nav, highlights. Text on it is Ink (about 15:1).  |
| Pink   | `#FF2D8F` | Urgent stickers, focus rings, counts. White text on it passes AA.     |
| Cherry | `#FF4B5C` | Critical alerts and errors only                                        |
| Haze   | `#A6A9D6` | Secondary text, timestamps                                             |

**Light mode:** lime is too pale for text on white. Light mode uses navy buttons with lime
text, and a deeper pink (`#D10F6D`) for links and focus.

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
