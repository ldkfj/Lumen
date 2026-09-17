---
name: Lumen
genre: editorial-evidence-platform
macrostructure: split-public-product
theme: midnight-indigo
tone: precise-confident-evidence-first
audience: AI infrastructure buyers, procurement teams, analysts, benchmark reviewers
primary_action: Open verification app
motion: restrained-functional-only
---

# Frontend design rationale

Lumen turns a marketing claim into a traceable chain from exact wording to official evidence, validator consensus, and an on-chain consequence. Its public surface therefore uses one continuous evidence path rather than a generic card grid or dashboard. The landing page explains the trust problem before exposing tools; the application keeps the evidence-heavy workflows separate and task-focused.

## Layer 1 — public landing and docs

- Primary identity: the approved new Lumen mark and wordmark. The GenLayer mark is never used as the product logo.
- Composition: asymmetric editorial hero with concise copy on the left and a custom evidence-flow illustration on the right.
- Flow content: frozen claim → official benchmark row → validator consensus → on-chain result. This is explanatory structure, not fake live data or a fabricated metric.
- One primary CTA: `Open verification app`. Secondary navigation uses text links for `How it works`, `Docs`, and `Limitations`.
- A large, low-contrast official GenLayer symbol may appear as a background watermark; attribution reads `Built on GenLayer`.
- Docs remain part of the public layer and explain purpose, required inputs, wallet selection, each write flow, fee review, finality/execution, readback, public verification, and limitations using exact product labels.

## Layer 2 — functional application

- Routes: registry, register, claim detail, assessment history, and limitations.
- Evidence rows and definition lists replace repetitive cards. The official-row inspector is the only strongly contrasting data surface.
- The wallet chooser, fee review, transaction journal, lifecycle states, readback, and recovery controls consume one canonical integration state; presentation code must not create parallel connection or success state.
- No verdict is computed in the browser.

## Visual system

- Near-black indigo ground, cool white type, muted periwinkle labels, and one electric-violet action accent.
- Typography combines a restrained geometric display face with a highly legible sans body and monospace evidence identifiers.
- Square-to-soft radii only where controls or evidence boundaries require them; avoid pill proliferation.
- No stock people, device mockups, browser chrome, glassmorphism, arbitrary glow fields, decorative charts, testimonials, logo walls, invented metrics, or equal-sized feature-card grids.
- Use native CSS/layout before adding dependencies. No animation library; motion is limited to state transitions and respects reduced motion.

## Responsive and accessibility acceptance

- Verify at 320, 375, 414, 768, 960, 1440, and 1920 CSS pixels.
- Semantic landmarks, skip link, heading order, real labels, visible focus, keyboard-complete menus/dialogs, live status/error regions, and at least 44px touch targets.
- Evidence hashes and long claim text wrap safely. No horizontal overflow.
- The wallet dialog traps focus, closes on Escape, restores focus, and leaves all errors inside the dialog while open.
