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
[The TV's frame](#the-tvs-frame) · [The quiz on the TV](#the-quiz-on-the-tv) ·
[Participant fusion on the TV](#participant-fusion-on-the-tv) ·
[The standings](#the-standings) · [The winner's screen](#the-winners-screen) ·
[The recap on the TV](#the-recap-on-the-tv) · [The phone](#the-phone) ·
[The host room](#the-host-room) · [Old names](#old-names) ·
[Guards](#guards) · [The acceptance test](#the-acceptance-test)

## Colour jobs

Only Hurra's colours exist: the theme resets Tailwind's stock palette, so
`bg-amber-600` draws nothing (see [Guards](#guards)).

| Token | Job, and only this |
| --- | --- |
| `gold` | What is on air, the leader or winner, and the one next step on a screen (the default Button). Never decoration, never a quiz key. |
| `gold-rim` | Pressed gold. Never text. |
| `pink` | The hunt (Last one standing): its tab, the word Out and the stripe across a knocked-out guest's token, the scan action. The core never names the game: a game asks for it with `GameModule.accent: 'hunt'`, and every tab the frame draws for it (the news strap, the programme strap, a phone's tab) turns pink with the stripes. |
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
| `raised` | `#1e1a16` | The band, the host header and panels, cards, the TV's cards, dialogs and sheets |
| `overlay` | `#29241e` | Answer tiles, secondary buttons, menus, fields, a well inside a raised panel |
| `rule` | `#3a332a` | The line colour: quiet buttons, empty pips, dividers; and a menu's highlighted item |

Whatever sits on a surface is one step above it, or it disappears: a
secondary button, a field or a well on a raised card or dialog is overlay,
and a menu's highlighted item on the overlay menu is rule. That is why
dialogs and sheets stand on raised, not on the menus' overlay.

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
- `tabular-nums` only on figures alone: a score, a count, a rank. Schibsted
  Grotesk's tabular comma, full stop, colon and semicolon are as wide as a
  digit, so 21:40, 2,350, 2.9 s or a sentence would open gaps ("21 : 40").
  A time or a figure with a separator that must keep its width, a clock or a
  count running up, is set in `tv-num`, whose tabular figures leave
  punctuation narrow.

TV sizes, at 1080p. Nothing on the TV is under 28 px. On short screens
(`short:`, 960 px tall or less: 1440 by 900 and 720p) each size steps down one
place in this list, so `text-tv-question short:text-tv-answer`; the floor has
no step below it. A screen that holds a hero figure and a full layout at once
(the quiz's question) may step once more on low screens (`low:`, 800 px tall
or less: 720p and 768p), `low:text-tv-name`, never below the floor: 28 px on
a 720p screen is 42 at 1080p.

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
- Only tabs, letter chips, hero tokens and the quiz's answer pips tilt. Rows
  never do.
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
- **Card:** a raised panel with no hairline. Its ring stays transparent: a
  state is a word on a chip (see [The host room](#the-host-room)), never a
  coloured edge.
- **Badge:** square chips that carry words. `default` gold (on air, live,
  leading), `secondary`, `outline`, `ghost` (a plain word: Done, Ready),
  `destructive`, and `hunt` (pink: Out).
- **Slider:** a paper range and thumb on a rule track.
- **Input**, and Textarea and the Select trigger beside it: the overlay
  surface edged in `paper-3` at 60 percent. A field's edge is the one line
  that must reach 3 to 1 against what it sits on (WCAG 1.4.11), so it is
  found before it is focused: 3.2 to 1 on a raised card or dialog, where a
  `rule` edge would be 1.4.

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

**AvatarBadge** puts a square chip across a token's bottom right corner: the
winner's crown in gold, or the camera on your own token before you add a
photo in paper, since gold is a screen's one next step (Show my code on the
phone home). Out is never a badge.

## The TV's frame

Every TV screen but the recap and the pairing screen stands in one on-air
frame ([src/components/tv/TvScreen.tsx](../src/components/tv/TvScreen.tsx)),
inside the 5 percent safe area (`px-[5vw] py-[5vh]`), so a TV that crops its
edges never cuts anything off. Games play inside it and get it for free.

- **The programme strap** (top left,
  [Header.tsx](../src/components/tv/Header.tsx)): a tilted gold tab (the
  hunt's is pink with the stripes) with one short word for what is on (the stage game's title, Next, Standings, The
  end), then a paper strap with where it is. While a game holds the stage the
  strap carries the game's own words, its `TvStatus` `strap` variant
  ("Question 3 of 10"); a game without them gets "Running since 21:40", or
  "Final result". Between games it says what comes next in the host's order
  ("Quiz then Who is fused?"), or how the last game went. `sceneLine` in
  [scene.ts](../src/components/tv/scene.ts) decides, and its tests pin it.
  No stock icon.
- **The bug** (top right): the party's name in `paper-2` (a long one ends in
  an ellipsis), the time of night in `tv-num`, and the logo. Over a winner's
  colour field the bug's words turn ink and the strap's tab stands on ink
  (see [The winner's screen](#the-winners-screen)).
- **The stage**: the full width between the strap and the band, clipped at
  its edges so a scene that runs out of room never paints over the band. What
  a stage screen gets at 1080p: 800 px of height with one band line and 732
  with two; at 1440 by 900, 666 and 606; at 720p, 504 and 444.
- **The band** (bottom, [Band.tsx](../src/components/tv/Band.tsx)): one line
  per game running in the background, each 60 px (52 on short screens) and
  never wrapping. A game draws its own line with its `TvStatus` `band`
  variant and the parts in [onAir.tsx](../src/components/tv/onAir.tsx)
  (`Tab`, `Stripes`, `BandLine`, `BandCount`, `BandText`, `BandSince`,
  `BandEvent`); any other gets the plain line, its title and "Running since"
  the time it started. The oldest start stands at the bottom, so Last one
  standing keeps its place all night; at most two lines, and past that the
  newer games share one "Also running" line. More lines, such as a slim line
  with the night's top five, join the band's `lines` list. While a game holds
  the stage and joining is open, "Join with HURRA30" stands at the band's
  right.
- **The way in** (`joinPlace` in scene.ts): before anyone joins, the lobby
  ([Lobby.tsx](../src/components/tv/Lobby.tsx)) is one big QR code; while
  the standings show, the board's own join block (see
  [The standings](#the-standings)), at every party size; while a game holds
  the stage only the band's code ([Join.tsx](../src/components/tv/Join.tsx)),
  and the same for a party of 4 or more while a game without a screen of its
  own holds the stage, whose card stands beside the podium. One way in at a
  time, never two. Codes are paper, never gold, and the address is always the
  running page's own origin.
- **News** ([news.ts](../src/components/tv/news.ts) routes it): big news is
  a strap across the whole top row for 8 seconds, over the programme strap
  and the bug, so it never covers the stage (a quiz's answered count
  included) or the band. Its tab is the game's title, pink with the stripes
  for any news from the hunt and gold for anything else on air. A game's
  own news never covers its final screen, which shows the result itself:
  there it only plays its sound (`newsStage` in scene.ts). Over a winner's
  colour the strap stands on that colour, not the ground. News from a game in
  the background is the band's event line (the ticker), with its time.
  Nothing crawls, there is no "Breaking" label and no red, and an event line
  changes only when something happens. The TV says a game's news without its
  exclamation marks (`onAirText` in src/lib, which a phone's toasts use too).
- **Times** are only the ones the database holds (a game's start or finish,
  an announcement's), as clock times (`clockTime` in
  [clock.ts](../src/components/tv/clock.ts)): never "4 min ago" and never a
  planned time.
- **The title card** ("Hurra presents", 3 seconds, with the gong) is the gold
  tab and the game's name in `wide` Archivo on the plain ground: no
  spotlight, no wash.
- **The corner** (bottom left, in the gutter under the band) is the laptop's,
  not the programme's: full screen, sound ("Click for sound" until the
  browser lets the TV play any), the picture (a sun, "Brighter picture" to a
  screen reader, pressed while it is on) and the connection as a word
  ("Live", "Reconnecting"), never a coloured dot. It is quiet in `paper-3` at
  a small size and sits outside the safe area: the one place on the TV under
  the 28 px floor, because nobody watches it from the sofa.
- **Brighter picture**, for a TV that crushes dark tones into black: the same
  look with its dark end raised, Standard by default. The TV page sets
  `data-tv-picture="bright"` on the document's root
  ([picture.ts](../src/components/tv/picture.ts)) and src/index.css lifts
  six tokens under it, so no screen knows: `ground` `#2a2520`, `raised`
  `#443d35`, `overlay` `#5c5247`, `rule` `#706455`, `paper-2` `#dfd4c3`
  (10.4 to 1) and `paper-3` `#c6bba7` (8.0 to 1). Panels stand 1.4, 2.0 and
  2.6 to 1 off the ground (standard: 1.1, 1.2 and 1.5). Gold, pink, the key,
  the guest colours, paper, ink and photos stay as they are. Each TV, Show
  the TV here's tab included, remembers its picture (localStorage,
  `hurra:tv:picture`), and `?picture=bright` on its address sets it.

## The quiz on the TV

The quiz's stage screens ([src/games/quiz/TvView.tsx](../src/games/quiz/TvView.tsx),
[Podium.tsx](../src/games/quiz/Podium.tsx), with their sizes in
[look.ts](../src/games/quiz/look.ts) and the parts phones and the host page
share in [parts.tsx](../src/games/quiz/parts.tsx)). The strap says where the
quiz is ("Question 3 of 10"), so the stage never repeats it.

- **The question:** Schibsted Grotesk at 800, `text-tv-question` (86 px), two
  lines at most. It starts at the largest size and steps down
  (`QUESTION_STEPS`, each with its `short:` and `low:` step) while it takes a
  third line, measured before paint. Only a question past about 150
  characters on a short screen reaches the floor and wraps to a third line.
- **The answers:** a 2 by 2 grid of `overlay` tiles (`rounded-tile`), A and B
  on top, C and D below, the same places as on every phone; true or false is
  one row. Each tile has its tilted letter chip in the key (`LetterBadge`,
  `rounded-chip`, the letter in `wide`) and the answer in the reading face at
  700, `text-tv-answer` (66 px). All answers share one size, the largest at
  which each fits its tile without breaking a word (`OPTION_STEPS`).
- **The countdown:** one figure in `tv-num` at `text-tv-count` (250 px) with
  "seconds left" under it, in place of a bar. Paper, gold only for the last
  5 seconds (`URGENT_MS`) while the tick-tock plays, `paper-3` with "Time's
  up". Everywhere else the countdown follows the same rule: `SecondsLeft` and
  `DrainBar` are paper, gold for the last seconds; never pink, which is the
  hunt's.
- **The pips:** one tilted paper square per guest, filled as they answer (an
  empty one is a `rule` outline), with "17 of 24 have answered": counts only,
  never names. They shrink to fit their row, so 45 guests still fit on one
  line. The host page's dots are small paper squares.
- **The reveal:** the question and tiles stay. The right answer's tile turns
  `paper` with ink, a check and how many picked it; the others step back to
  `raised` with their chip in `rule` and `paper-3` text. Never fade a key
  colour with opacity: on the ground it turns to mud. Then "6 of 11 got it
  right" and the fastest right answers, times in `tv-num`, where the pips
  were.
- **The leaderboard** after each question ("The quiz so far"): solid `raised`
  rows, the leader's rank and points gold and everyone else's paper, a gain
  on an `overlay` chip.
- **The final:** "Hurra for Ana" in `wide` beside the winner's tilted token,
  "Won the quiz with 2,748 points." with the points gold, and "The third hurra
  is saved for the night's winner." The top three stand on `paper` steps of
  clearly different heights, the place in `wide`, the winner's points on
  gold. Confetti is the logo's pieces in the logo's colours, behind the words.
- **Room:** the question screen fits the stage with two band lines at every
  size (444 px at 720p). The night's top five is not on the TV during a
  question; if it is wanted, it joins the band as one slim line (The TV's
  frame).

## Participant fusion on the TV

Fusion's stage screens ([src/games/fusion/TvView.tsx](../src/games/fusion/TvView.tsx),
with its parts in [tvParts.tsx](../src/games/fusion/tvParts.tsx), the wall's
layout in [wall.ts](../src/games/fusion/wall.ts) and the reveal's timing in
[reveal.ts](../src/games/fusion/reveal.ts)) speak the quiz's language
without importing it. The strap says where the round is ("Showing 3 of 12",
"4 of 12 revealed", "Picture 4 of 12"), so the stage never repeats it.

- **The lobby:** words only, as the quiz's: "Two guests, one face" in `wide`,
  "Who is in each picture?", how it scores, and "Getting the pictures ready:
  8 of 12" at the foot until every picture is in.
- **The frame and the column** (the showing and a picture asked): the
  picture on the left at the stage's full height, `raised` with
  `rounded-tile`, the image whole inside it; its shape is the pictures' own,
  portrait or square, at most half the stage. The column beside it, top
  aligned, holds the label chip (paper with ink, `wide`, tilted 2 degrees, at
  the question's size) and the words. One frame through the showing, the
  asking and the reveal, so the picture never jumps; between a wall tile and
  the frame, and from the frame to the middle at its reveal, it moves
  (motion's shared layout), a crossfade with reduced motion.
- **The showing:** each picture crossfades into the next over 600 ms, never
  blinking: the one before stays under it until it is covered. "Look closely."
  and one pip per picture at the column's foot, paper up to the one on show.
- **A picture asked:** "Who is in it?", the quiz's countdown (`tv-num` at
  `text-tv-count`, paper, gold for its last 5 seconds, `paper-3` with "Time's
  up", then "The answer is coming."), and the lock-in pips with "7 of 22 have
  locked in": counts only, never names. The pips' total is the guests less
  two, so the room never learns that someone in the picture has left.
- **The reveal**, the round's big moment, centred on the whole stage and
  reading as "Ana + Bo = this picture": the picture moves from the frame to
  the middle (500 ms) at the row's full height, its label chip on its top
  left as on the wall. After a beat the two people come in, the first sliding
  in from the left at 0.7 s and the second from the right at 0.85 s (550 ms,
  ease-out; with reduced motion they fade), each a square 72 percent of the
  picture's height: their own photo from the settings on `raised` with
  `rounded-tile`, else their profile photo, else their token. Each is named
  on a paper name chip across its foot, the wall's chip (`NameChip`, the
  condensed numerals, the first tilted one way and the second the other) at
  `text-tv-answer` (`short:` score, `low:` name), landing like a tab; a bare
  token gets none, since its slate says the name. Then one line of counts
  ("8 of 21 got both, 6 got one", "Nobody got both. 6 got one.") and
  "Sharpest eyes" with the top three, rank 1 in gold, both centred under it;
  the sharpest eyes only on a stage 480 px tall or more (not 720p with two
  band lines). Every part is laid out from the start, so nothing moves when
  the words come in. The own photos are secret until this moment, so they
  load from the reveal's own state (thumbnail and full image, at high
  priority) while the picture moves; a person whose photo isn't in by their
  beat comes in at 2 s at the latest, the photo fading in where it stands.
  It fits 1920 by 1080, 1440 by 900 and 1280 by 720 with zero, one and two
  band lines: the three are sized from the row's own room by a size
  container (`--fh`, `--side` in `RevealStage`), never wider than the stage.
- **The wall:** every picture at once, 1 to 40, as big as the stage allows,
  uniform tiles that never tilt. Each tile has its label chip at
  `max(28px, min(11cqw, 50px))`, every chip on one wall in the same face
  (`wide`, or the condensed one for all where any label needs it). A revealed
  tile carries the two first names as two paper name chips at the picture's
  foot, tilted like its label chip (one each way), at
  `max(28px, min(13cqw, 44px))`, with the picture whole behind them (the
  owner's choice over a solid band, 25 Nov); a tile under
  132 by 165 px carries the two tokens instead, since a name there would go
  under the floor (from 17 pictures at 720p; the party's 12 always show names).
- **Gold** is the strap's tab, the countdown's last 5 seconds and the leader's
  rank and points. No pink, no wash, no glow: a picture stands on `raised`.
- **The final** is the winner's screen (below), with "The sharpest eye, with 9
  points." and the best disguise at the time it was revealed.

## The standings

The board between games ([src/components/tv/Board.tsx](../src/components/tv/Board.tsx))
has two columns, both measured in [fit.ts](../src/components/tv/fit.ts), so it
fills whatever stage the frame gives it:

- **The leader's column:** the leader as a hero (their token at 264 px,
  their points at `text-tv-lead` in gold, what they last won at its finish
  time, on two lines rather than cut when the column is narrow, and their
  lead, "2 ahead of Ana"), the next five places large (names
  at `text-tv-name`, points at `text-tv-score`), and one line on how the last
  game moved the places ("Beer pong moved Luna up 4 places and Clara up 3.",
  from that game's points, `placesMoved` in
  [stage.ts](../src/lib/stage.ts)). A guest's name is printed beside the hero
  only with a photo or the word Out: otherwise the slate says it.
- **The field:** everyone else in plain rows on the ground, no cards and no
  bars, in fit.ts's row layouts (the floor of 28 px in the smallest), filled
  top to bottom. The join block stands under it while joining is open: the
  QR code on paper, the code at `text-tv-code` and the page's own address,
  one step smaller again on a low screen (`low:`), so it still fits a 720p
  board.
- **Movers** are a triangle and a count in `paper-2`, never green or red.
- **Gold** is the leader's: their points, the crown, the rank and points of
  anyone tied for first (everyone tied for first wears the crown). Nothing
  else on the board is gold, not even the join code.
- **Out:** the word in pink beside the name and the stripe on the token, for
  everyone a live game's `knockedOut` hook names.
- **When it doesn't fit:** places that don't fit under the hero join the
  field, the leader's column narrows (half, then 44, then 38 percent), the
  join block gives way to its short form ("Join with HURRA30" over the
  address, which is never cut), and as a last resort the field ends in "and
  17 more". No text goes under the floor to make room.

## The winner's screen

A game's winners ([src/components/tv/WinnerMoment.tsx](../src/components/tv/WinnerMoment.tsx)),
for Last one standing and for any game whose final screen is the generic one
([FinalScreen.tsx](../src/components/tv/FinalScreen.tsx)). A still layout:
everything fades in, and only the confetti moves.

- **The field:** the first winner's guest colour covers the top 65 percent of
  the TV, behind the frame (a fixed layer under the stage, so no ancestor of
  the stage may set a `transform` or `filter`). It carries
  `data-tv-field="<colour>"`, so the frame can set its words in ink while it
  shows: the frame's `main` is `group/frame`, and over the field the strap's
  tab stands on ink with gold words and the bug's name and clock turn ink
  (`group-has-[[data-tv-field]]/frame:`). Paper stays paper on it; ink reads
  6.9 to 1 or more on every guest colour.
- **On it, in ink:** the winner's photo, or their name slate inverted (their
  colour on ink, so it stands out of a field of the same colour), tilted 4
  degrees with a hard ink shadow; the cheer, "Hurra for Bo!", the product's
  one exclamation mark, in `wide` at up to 176 px and fitted to the room; the
  deck ("The last one in, with 7 knockouts.") and the last thing that
  happened at its clock time.
- **Beneath, on the ground:** "The night so far", what the game did to the
  night ("Last one standing gave Bo 10 points and a 4 point lead over Ana.")
  and, always, "The third hurra is saved for the night's winner."; and the
  night's top three on paper steps of clearly different heights (a tie
  shares a height), the game's points on them as a chip, gold for its winner.
  On a short screen the tokens move onto the steps, the steps go to one row
  (the name, this game's gain and the place: the standings carry the total),
  and the words drop the title, then the line, never the third hurra. In the
  least room (720p with two band lines) the podium gives way, so the promise
  stands whole on one line (`nightPodium` in fit.ts).
- **Confetti** ([src/components/Confetti.tsx](../src/components/Confetti.tsx))
  is only the logo's pieces in the logo's colours: the pink dot, the teal
  curl, the violet wave and the gold star. It bursts once and is gone in
  about three seconds; with reduced motion there is none.

## The recap on the TV

[RecapScene.tsx](../src/components/tv/RecapScene.tsx) takes the whole
screen, without the frame, in the same language: labels at the floor or
above, cards on the raised surface, icon chips by their job (gold a win,
pink the hunt, paper the rest), the progress in paper on rule, and no glow,
rings or gold washes. In the race each bar is its guest's own colour
(identity) and only the leader's points are gold. The night's podium is a
game's winner podium: "Hurra for Bo, Freja and Maja" in `wide` paper,
untilted, over paper steps of clearly different heights, the winners'
points on gold and their crown. It has no exclamation mark: the product's
one is a game's winner screen (the owner may move it to the night's
winner).

## The phone

The phone home, top to bottom: the header (the logo, the party, the sound),
the game on the main card when one holds it, your token and place ("7th, 8
points, 1 behind Felix and Luna"), On the TV (Now, Next and Later), each game
running underneath in its own section (oldest start first, so Last one
standing stays near the top all evening), what finished lately, Your night,
the standings card below the fold, and Show my code in the thumb zone.

- **A sheet never hides a timed question.** A game's full view opens in a
  sheet over the home, and Last one standing's stays open after a camera
  scan. When a timed question (a quiz question) opens on the main card, an
  open sheet gives way so its seconds aren't missed, unless it is still
  handling a scanned code (`sheetGivesWay` in
  [running.ts](../src/components/phone/running.ts)). The sheet's game keeps
  its state, and its section opens it again.
- **One gold step.** Show my code is the home's one gold bar (the default
  Button). A game's section carries no gold button and no gold Live chip:
  its actions are `outline` Buttons (Scan, Vote, Answer now), and a row on
  the overlay surface opens its full view. A section's tab is gold only while
  the TV shows its game (on air), pink for the hunt, paper otherwise. While a
  timed question holds the main card, or while a guest types into a game's
  text field (Lydspor's title and singer), the bar steps aside, so that
  screen has no gold button at all. [PhoneHome.test.ts](../src/components/phone/PhoneHome.test.ts)
  checks the timed question over the scenes, and
  [useTypingFocus.test.ts](../src/components/phone/useTypingFocus.test.ts)
  checks that typing holds while the focus moves from one field to the next.
- **The strap** over a game: its tab and a paper strap with the game's own
  words (`GameModule.phoneStrap`: "Question 3 of 10"), else "On the TV",
  "Since 20:30" or "Finished at 22:41". A long name and its words wrap, the
  strap under the tab, instead of cutting either.
- **Copy:** no exclamation marks ("You're in.", "That's a wrap."), and only
  times the database holds, as clock times. A game's news in a toast is said
  without its exclamation marks (`onAirText`), and a game's `red` tone (the
  hunt's "You're out") shows as the hunt's pink (`announcementTone`): the
  danger chip is only for errors.

### The quiz on a phone

- **During a question, letters only:** "The question is on the TV.", one line
  on how answering works, taken from the prompt's own rule (the quiz opens its
  prompts `final`, so "Your first tap counts."), four overlay tiles two by two
  with each letter's tilted chip in the quiz key (sized by container units),
  the seconds left in `tv-num` (gold for the last 5, as the TV's digit), and
  "Show the answers here".
- **Show the answers here** puts the question and the answers on the phone, as
  rows. Each phone remembers it in localStorage (`hurra:quiz:show-answers`,
  [showAnswers.ts](../src/games/quiz/showAnswers.ts)), behind try/catch; where
  storage fails, the page keeps the choice in memory.
- **A tap shows at once:** the picked tile turns paper and says Sending, the
  others fade, before the database answers
  ([answer.ts](../src/games/quiz/answer.ts)); then Locked in. A refusal rolls
  the tile back, and the status line says why. A tile's accessible name is its
  letter, with its answer when shown ("C: Copenhagen").
- **The reveal:** "You got it." with the points in paper, "Not this time." or
  "No answer this time.", then the answers as rows, the right one on paper
  with a check. No teal panel. Gold only for the leader and the winner.

### The hunt on a phone

- **Its section:** the pink tab; "You're still in.", or "You're out." with your
  token wearing the stripe and the word in pink; the line "18 of 24 left.
  Clara got Frida at 22:41." from the feed's own times
  ([hunt.ts](../src/games/elimination/hunt.ts)); the task card face down
  (SecretCard) with the popper's stripes on its edge; and an outlined "Got
  someone? Scan their code" with the scan icon in pink. "Who is left" opens
  the full view.
- **Results** stand on the raised surface, never on a gold or pink wash. The
  winner's crown and words are gold; Out is pink.

### Participant fusion on a phone

[PlayerView](../src/games/fusion/PlayerView.tsx), with its words in
[phoneLines.ts](../src/games/fusion/phoneLines.ts) and its parts in
[phoneParts.tsx](../src/games/fusion/phoneParts.tsx). The TV is the show:
phones load thumbnails only, and send eyes to the TV in the lobby and the
showing ("Now showing #3.").

- **Picking:** the asked picture's thumbnail, its label chip, "Who is in it?"
  and the seconds left (`tv-num`, gold for the last 5). Everyone but you on
  `overlay` tiles, four across, each with the token and the first name (a name
  breaks after its hyphen, Marie- over Louise, and a long one steps down a
  size rather than end in an ellipsis); a search over 16 guests. Guests on
  the host's guest list who haven't joined follow on the same tiles under
  "Not here yet" in paper-2, since a picture may be of one of them, and the
  search finds them too. A picked tile turns paper with a check.
- **Lock in** is the screen's one gold step, on a solid bar fixed to the
  screen's foot where Show my code stands at other times (it steps aside for
  the timed prompt), so the phone's toasts, which stack from 96 px up, never
  sit over it. Nothing is gold once locked in: "Locked in: Mads and Ida." with
  the two tokens, on `raised`.
- **The two in the picture** see the same picker and the same gold Lock in,
  under "This one is you. Keep a straight face and pick any two: it won't
  count.", and reach the same locked card. Their lock never leaves the phone,
  so a glance from the next seat can't tell and nothing they pick can score.
- **The reveal:** "You got both." with the points in paper, "You got one of
  the two.", "Not this time.", "No guess this time." or "That was you.", who it
  was (two small tokens wearing their own photos, thumbnails, where the
  settings have them; the TV shows them large), your two picks with "Right" and a check or "Not in it" (never colour
  alone, no red), and your place, named for the round: "You have 4 points,
  1st of the face detectives so far.", the rank gold only at 1st.

## The host room

The control room is a reskin of the same page: every function and every
confirmation stays where it was. Its own rules:

- **One gold step per item.** A game's host view has at most one gold button,
  its next step (the quiz's Reveal now, Show the leaderboard, Next question or
  Crown the winner; Participant fusion's Start the showing, Skip to the wall,
  Ask #5, Reveal now, Back to the wall or Crown the face detective). A step
  that skips ahead (skip the leaderboard, crown early, skip the wall) goes in
  the menu beside it, behind the same confirmation, never next to it. Fusion's
  Ask on each picture and the Save of who is in it are `secondary`. A
  program's Start is gold only on the game that is the room's next step,
  `nextStartId` in
  [src/components/host/scene.ts](../src/components/host/scene.ts): the first
  game not started, while a TV is open and shows the standings. Back to
  standings is gold on a final screen, Pair a TV while no TV is open.
- **States are words** on chips:
  [src/components/host/StateChip.tsx](../src/components/host/StateChip.tsx)
  (Live, Open on the overlay; Done, Not started, Closed as plain words;
  Archived in a rule outline). The game on the TV wears the gold On the TV
  chip, since it is on air, with the clock time it started (`started_at`).
  The connection dot is paper with Live, an empty ring with Catching up.
- **The player list** marks a knocked-out guest with the token's `out` stripe
  and the word Out in pink, from `knockedOutIds` (the games' generic
  `knockedOut` hook). Ranks are plain `tv-num` in `paper-3`, points `tv-num`
  in paper: no medal coins in the room. There is no Away tag: the app holds
  no presence data for players.
- **The guest list** card lists only the guests still expected, with their
  tokens; joined guests stay in the player list. Free the name is a gold
  confirm, not a destructive one: the guest can take the name again.
- **Numbers that change in place** (the TV sound level, the quiz's totals and
  gains, answered counts) are `tv-num`, so their columns hold still.
- **Wells:** a settings form or a question is an `overlay` well in a raised
  panel; cards inside a well stand on `raised`, their fields on `overlay`.
  Warnings and notes are solid panels with an icon, never a glass callout.

## Old names

The shadcn slots and the confetti names are aliases that point at the brand:
each is a `var()` of its token in src/index.css, so every screen not yet
restyled stands on the warm ground, and a token changed in the theme changes
its alias too. New code uses the token names; the aliases go once the last
screen has moved.

| Old name | Now |
| --- | --- |
| `background` | `ground` |
| `card` | `raised` |
| `popover`, `secondary`, `muted` | `overlay` |
| `accent` | `rule` (a menu's highlighted item) |
| `border`, `input` | `rule` |
| `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground`, `accent-foreground` | `paper` |
| `muted-foreground` | `paper-2` |
| `primary`, `ring` | `gold` |
| `primary-foreground` | `ink` |
| `destructive` | `danger` |
| `confetti-pink`, `confetti-teal`, `confetti-violet` | `pink`, `guest-teal`, `guest-violet` (the same teal and violet as `key-c` and `key-d`) |

## Guards

- **[src/lib/tokens.test.ts](../src/lib/tokens.test.ts)** fails on a stock
  Tailwind hue with a shade anywhere in src (any utility, with variants and
  opacity, in a CSS variable, a `theme()` call or a class built around
  `${hue}`), and on a raw colour outside src/index.css: a hex, or numbers in
  a colour function (`rgb(245_197_66/0.6)`, `hsl()`, `oklch()`). A glow at
  part strength mixes the token instead:
  `color-mix(in_oklab,var(--color-gold)_60%,transparent)`. Its short allow
  lists give each exception's reason (a canvas fill, a chart's palette, the
  dev builds' drawn faces). A new colour is a new token in index.css. It
  also holds the Brighter picture to its job: only the six dark tokens, each
  surface lighter, warm and a bigger step off the ground than in Standard,
  and `paper-2` and `paper-3` at 7 to 1 or more on its ground.
- **[src/lib/utils.test.ts](../src/lib/utils.test.ts):** `cn` merges classes
  by tailwind-merge's rules, which know only Tailwind's own scales. Untaught,
  `cn('text-paper', 'text-tv-question')` keeps only the size. A new size,
  radius, easing or animation in index.css goes into `THEME_SCALES` in
  [src/lib/utils.ts](../src/lib/utils.ts), and the test fails until it does.

## The acceptance test

The [token sheet](screenshots/token-sheet.png) is the acceptance test, and dev
builds draw the real one: run `npm run dev` and open `/dev/tokens`
([src/pages/dev/TokenSheet.tsx](../src/pages/dev/TokenSheet.tsx)). It shows
the fixtures' 24 guests with the real Avatar at the sizes the screens use
(24 to 32 px in phone and host lists and the board's rows, 38 px planned for
the TV's field, 64 px in the top five and on the podium, 120 and 200 px as
heroes), with and without a photo, in and out, then the switch at
95 and 96 px, every guest's name at 96 px and all 18 pairs. A production build
has neither the route nor its file. Before each merge, open it at 1920 by 1080
and compare it with the approved sheet. With it: no TV text under 28 px,
nothing outside the TV's 5 percent safe area, contrast as in [Text](#text), no
dashes in copy, one exclamation mark (the winner's screen), and only times the
database holds.
