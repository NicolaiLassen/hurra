# Hurra's identity: Running Order

Hurra is a TV channel for one night. Every screen stands on one warm studio
black, gold means only what is on air, the leader and the one next step, pink
is the hunt, Archivo (stretched wide and narrow) is the on-air voice and
Schibsted Grotesk is for reading. This page is for engineers: what each token
is for and what guards them. The tokens themselves are the first `@theme`
block in [src/index.css](../src/index.css), and the approved
[token sheet](screenshots/token-sheet.png) is the acceptance test.

**Contents:** [Colour jobs](#colour-jobs) · [Surfaces](#surfaces) ·
[Text](#text) · [Type](#type) · [Radius](#radius) · [Motion](#motion) ·
[Primitives](#primitives) · [The player token](#the-player-token) ·
[Old names](#old-names) · [Guards](#guards) ·
[The acceptance test](#the-acceptance-test)

## Colour jobs

Only Hurra's colours exist: the theme resets Tailwind's stock palette, so
`bg-amber-600` draws nothing (see [Guards](#guards)).

| Token | Job, and only this |
| --- | --- |
| `gold` | What is on air, the leader or winner, and the one next step on a screen (the default Button). Never decoration, never a quiz key. |
| `gold-rim` | Pressed gold. Never text. |
| `pink` | The hunt (Last one standing): its tab, the word Out and the stripe across a knocked-out guest's token, the scan action. |
| `danger` | Destructive host actions only. |
| `key-a` to `key-d` | The quiz key: A coral, B pink, C teal, D violet. Always with the letter and in its fixed place. Pink and teal sit on a diagonal, because people with deuteranopia see them as almost the same colour. |
| `guest-coral`, `guest-teal`, `guest-violet`, `guest-sky`, `guest-lime`, `guest-paper` | Identity only: a guest's token, their own phone, the winner's field. |
| `white`, `black` | QR quiet zones, scrims and device frames. |

A state never rests on colour alone. It carries a word: Out, Live, Done.

## Surfaces

One warm black, lighter with elevation. Surfaces are told apart by value, not
by hairlines: no glass (transparency or blur) and no ring around a panel.

| Token | Value | For |
| --- | --- | --- |
| `ground` | `#14110e` | Every page, the TV's backdrop |
| `raised` | `#1e1a16` | The band, the host header and panels, cards, the TV's cards |
| `overlay` | `#29241e` | Answer tiles, secondary buttons, menus, fields |
| `rule` | `#3a332a` | The only line colour: quiet buttons, empty pips, field borders |

## Text

| Token | On the ground | For |
| --- | --- | --- |
| `paper` | 15.9 to 1 | Primary text; also straps, podium steps and the QR block |
| `paper-2` | 10.3 to 1 | Secondary text |
| `paper-3` | 6.6 to 1 | Ranks, log times, placeholders; 28 px and up on the TV |
| `ink` | 6.9 to 1 or more on each colour | Text on paper, gold, pink, the key and the guest colours |

## Type

- **Schibsted Grotesk** (`font-sans`, every page's default) is for reading:
  body text, and headings in the host room and on phones (weight 800).
- **Archivo** (`font-display`) is the on-air voice, through three utilities.
  Each sets its own weight, so don't add `font-bold` and the like:
  - `on-air`: 125 percent wide, 900, uppercase. Tabs and labels.
  - `wide`: 125 percent wide, 900. The big words.
  - `tv-num`: 62 percent condensed, 800, tabular figures. Numbers and names.
- `stripes` draws the popper's gold and pink stripes, the mark of the hunt.

TV sizes, at 1080p. Nothing on the TV is under 28 px. On short screens
(`short:`, 960 px tall or less: 1440 by 900 and 720p) each size steps down one
place in this list, so `text-tv-question short:text-tv-answer`; the floor has
no step below it.

| Class | px | For |
| --- | --- | --- |
| `text-tv-count` | 250 | The countdown |
| `text-tv-lead` | 200 | The leader's points |
| `text-tv-cheer` | 176 | The winner's cheer |
| `text-tv-code` | 92 | The join code |
| `text-tv-question` | 86 | A question, two lines at most |
| `text-tv-answer` | 66 | Answers |
| `text-tv-score` | 60 | The top five's points |
| `text-tv-name` | 50 | The top five's names |
| `text-tv-field` | 33 | Names in the field |
| `text-tv-body` | 32 | The band and commentary |
| `text-tv-tab` | 30 | Tabs |
| `text-tv-floor` | 28 | Out, small labels: the floor |

Phone sizes: `text-phone-key` 92 px (answer letters), `text-phone-place`
40 px (your place), `text-phone-head` 26 px, `text-phone-action` 18 px (in
54 px buttons).

The faces load from `@fontsource-variable/archivo` (its width file: one 90 KB
Latin file, widths 62 to 125 percent, with æ, ø and å) and
`@fontsource-variable/schibsted-grotesk`. [index.html](../index.html) preloads
Archivo's Latin file, and [src/lib/fonts.ts](../src/lib/fonts.ts) keeps the
first open's loader up until both faces are in (3 seconds at most), so no
first frame, a TV title card included, is drawn in a fallback face.

## Radius

| Class | Size | For |
| --- | --- | --- |
| `rounded-token` | 14 percent | Every player token |
| `rounded-chip` | 4 px | Letter chips, tally and state chips (Badge) |
| `rounded-tile` | 6 px | TV answer tiles |
| `rounded-control` | 8 px | Host buttons and fields (Button, Input) |
| `rounded-phone` | 14 px | Phone tiles and buttons (Button size `xl`) |

shadcn's `rounded-sm` to `rounded-4xl` still scale from `--radius` (8 px) for
screens not yet moved.

## Motion

- `ease-out` for everything; `ease-tab`, the one small overshoot, for tabs
  only.
- `animate-strap-in`: a strap wipes in from its left edge (220 ms).
  `animate-tab-land`: a tab lands from 6 degrees and 1.08 scale (180 ms).
- Only tabs, letter chips and hero tokens tilt. Rows never do.
- `MotionConfig reducedMotion="user"` wraps the app
  ([src/main.tsx](../src/main.tsx)): with reduced motion on, motion's
  animations skip moves and scales and keep fades. CSS animations need their
  own `motion-reduce:` handling.

## Primitives

The shadcn primitives in [src/components/ui](../src/components/ui) carry the
jobs, with their props and variant names unchanged:

- **Button:** `default` is gold, the one next step on a screen. `secondary` is
  the overlay surface, `outline` the quiet rule outline, `ghost` bare,
  `destructive` danger, `link` paper with a `paper-3` underline. Host sizes
  use the control radius; `xl` is the phone's 54 px button with the phone
  radius and 18 px text.
- **Card:** a raised panel with no hairline. Its ring is transparent, so a
  screen can colour it to mark a state (`ring-gold/40` for the game on the TV).
- **Badge:** square chips that carry words. `default` gold (on air, live,
  leading), `secondary`, `outline`, `ghost` (a plain word: Done, Ready),
  `destructive`, and `hunt` (pink: Out).
- **Slider:** a paper range and thumb on a rule track.
- **Input**, and Textarea and the Select trigger beside it: a rule border on
  the overlay surface.

## The player token

Every guest is one square token:
[src/components/Avatar.tsx](../src/components/Avatar.tsx), with the props it
always had (`name`, `playerId`, `src`, `className`) and `out`. The call site
gives the size; everything inside follows it through a container query and
container units, so the same token works from a 24 px chip to a 200 px hero.

- **Shape:** a square with `rounded-token` (14 percent).
- **With a photo:** the square crop, with a band in the guest's colour along
  the bottom (7.5 percent of the token, 3 px at least).
- **Without one** (and while it loads, and if it fails): the guest's colour.
  Under 96 px, their piece in ink, 62 percent of the token. From 96 px, their
  whole first name instead: Archivo at 62 percent wide and weight 900, tilted
  4 degrees, fitted so it is never cropped. A hyphenated name breaks after
  the hyphen (Marie- over Louise). Never initials.
- **Out** of Last one standing (`out`): one pink stripe from the bottom left
  corner to the top right (10 percent, 4 px at least), over the piece at half
  strength or the photo at half brightness. The band and a name stay at full
  strength. The stripe never says it alone: wherever a knocked-out guest's
  name is printed, the word Out sits beside it in pink.

**Colour and piece** come from one function, `guestLook(name)` in
[src/lib/guest.ts](../src/lib/guest.ts): six guest colours (coral, teal,
violet, sky, lime, paper) times three pieces (dot, curl, wave), keyed on the
name with the hash that always coloured a guest. So the TV, every phone and
the host room agree without asking anyone. Gold and pink have jobs, so they
are never a guest's colour. Two guests can share a pair; a small token always
has the name beside it.

**The pieces** are the logo's own confetti:
[src/components/Piece.tsx](../src/components/Piece.tsx) draws the paths from
[public/favicon.svg](../public/favicon.svg), each framed in a square of its
own, in the current text colour. The curl lies at 45 degrees so it never
reads as an S, and it crosses the out stripe instead of hiding under it. The
star stays in the confetti: on a small tile it reads as the AI sparkle.

**The name's fit:** `slateSize` gives the largest size at which the longest
line, tilted, takes at most 78 percent of the token both ways; a short name
(Bo, Ida) stops at 58 percent. It adds up Archivo's advance widths at that
instance from a table measured in Chrome (kerning only ever narrows a word,
so the sum is never short), and counts a character Archivo lacks as wider
than any of its own. Change the slate's face, width, weight or tilt, and
measure the table again: [src/lib/guest.test.ts](../src/lib/guest.test.ts)
holds real browser widths the fit must never undercut.

**AvatarBadge** puts a square gold chip across a token's bottom right corner:
the winner's crown, or the camera on your own token before you add a photo.

## Old names

The shadcn slots and the confetti names are aliases that point at the brand,
so every screen not yet restyled stands on the warm ground. New code uses the
token names; the aliases go once the last screen has moved.

| Old name | Now |
| --- | --- |
| `background` | `ground` |
| `card`, `muted` | `raised` |
| `popover`, `secondary`, `accent` | `overlay` |
| `border`, `input` | `rule` |
| `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground`, `accent-foreground` | `paper` |
| `muted-foreground` | `paper-2` |
| `primary`, `ring` | `gold` |
| `primary-foreground` | `ink` |
| `destructive` | `danger` |
| `confetti-pink`, `confetti-teal`, `confetti-violet` | `pink`, and the teal and violet of the key and the guest colours |

## Guards

- **[src/lib/tokens.test.ts](../src/lib/tokens.test.ts)** fails on a stock
  Tailwind hue with a shade anywhere in src (any utility, with variants and
  opacity, in a CSS variable, a `theme()` call or a class built around
  `${hue}`), and on a raw hex colour outside src/index.css. Its short allow
  list gives each exception's reason (a canvas fill, a chart's palette). A
  new colour is a new token in index.css.
- **[src/lib/utils.test.ts](../src/lib/utils.test.ts):** `cn` merges classes
  by tailwind-merge's rules, which know only Tailwind's own scales. Untaught,
  `cn('text-paper', 'text-tv-question')` keeps only the size. A new size,
  radius, easing or animation in index.css goes into `THEME_SCALES` in
  [src/lib/utils.ts](../src/lib/utils.ts), and the test fails until it does.

## The acceptance test

The [token sheet](screenshots/token-sheet.png) is the acceptance test. Before
each merge, render every guest at every size (38 px in the TV's field, 64 px
in the top five and on the podium, 120 and 200 px as heroes), with and
without a photo, in and out, and compare. With it: no TV text under 28 px,
nothing outside the TV's 5 percent safe area, contrast as in [Text](#text), no
dashes in copy, one exclamation mark (the winner's screen), and only times the
database holds.
