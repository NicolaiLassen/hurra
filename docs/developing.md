# Developing Hurra

How Hurra is built, how to write a game for it, and how to run and ship it.

What Hurra is and how a party plays is in the [README](../README.md). How every
screen connects, for guests, the host and the TV, is in
[user-flows.md](user-flows.md).

**Contents:** [How it fits together](#how-it-fits-together) ·
[Data model](#data-model) · [Pages](#pages) ·
[Writing a game](#writing-a-game) · [Local development](#local-development) ·
[Production](#production) · [Sound effects](#sound-effects)

## How it fits together

- **Frontend:** React + Vite + Tailwind + [shadcn/ui](https://ui.shadcn.com),
  hosted on Netlify as a single-page app. shadcn components live in
  [src/components/ui](../src/components/ui) and are ours to edit; add more with
  `npx shadcn@latest add <component>`. The look is Running Order: its tokens
  are the `@theme` block in [src/index.css](../src/index.css), and
  [identity.md](identity.md) says what each colour, size and radius is for
  and which tests guard them. Type is Archivo and Schibsted Grotesk.
  Icons are [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`,
  bold by default via `IconContext` in [src/main.tsx](../src/main.tsx)). The
  TV animates with `motion`, loaded only on the TV page and the games' TV
  screens, so phones never download it; only its `MotionConfig`, which makes
  every motion animation follow the device's reduced motion setting, wraps the
  whole app (a CSS animation carries its own `motion-reduce:` classes). The app icon is
  [public/favicon.svg](../public/favicon.svg); the PNGs next to it are rendered from it.
- **Sound:** phones and the TV download their sounds when they open and decode
  them into memory with the Web Audio API
  ([src/lib/sound.ts](../src/lib/sound.ts)), so a sound starts the instant it's
  triggered. One sound plays at a time, through a limiter. Phones load only the
  four they play; the TV loads all ten. [netlify.toml](../netlify.toml) lets
  browsers cache `/sounds/*` (a day fresh, then up to a week from the cache
  while it revalidates). Browsers allow sound only after a first tap; until
  then the sound toggle shows it is locked (on the TV, *Click for sound*).
- **Backend:** Supabase, plus one Netlify Function for game logic. The design
  doc is [docs/engine-v2.md](engine-v2.md).
  - **Postgres** holds parties, players, games and their state, the points
    ledger and an event log of the whole night, all from one init file and
    small additive migrations after it
    ([supabase/migrations](../supabase/migrations)), each of which checks its own
    grants and policies and aborts if one is missing.
  - **Anonymous auth** gives every phone a user on its first visit. The
    session lives in the browser's localStorage, so reopening the page brings
    the guest back as the same player.
  - **Row level security:** guests read only their own party, their own
    private views, answers and toasts. Game settings (quiz answers, who is in a
    picture), full game states and the event log are for hosts only.
  - **Prompts:** answers and votes go from the phone straight to Postgres
    (`submit_answer`), one round trip, never through the engine, so 45 answers
    at once all land.
  - **Realtime:** every save sends one tiny Broadcast ping on a private topic
    (the party, the stage, or one player), and screens then read one
    `session_snapshot`. No table is published to Postgres Changes.
- **Netlify Functions:**
  - [game](../netlify/functions/game.mts) (`POST /api/game`) is the game engine
    ([netlify/lib/engine.ts](../netlify/lib/engine.ts)): two database round trips
    per request, `game_load` then `game_commit`, around the pure `step()` in
    [src/games/core/runtime.ts](../src/games/core/runtime.ts). It runs with the
    Supabase secret key, so players can't cheat and games can keep secrets.
  - [keep-alive](../netlify/functions/keep-alive.mts) runs daily and calls
    `rpc/keep_alive`, because free Supabase projects pause after a week
    without activity (the app then can't log anyone in).

### Data model

| Table | What it is |
| --- | --- |
| `sessions` | A party. `join_code` is in the join QR; `status` open/closed controls joining; `spotlight_game_id` is the game on the TV; `sound_volume` is how loud the TV plays its sound effects (phones keep their own). |
| `players` | A guest in a party, tied to their auth user. `code` is in their personal QR. |
| `session_games` | A game in a party: `game_type` picks the plugin, `public_state` is what everyone sees, `wake_at` when it wants a timer sync. Several can be `active` at once. |
| `game_settings` | A game's settings (quiz questions and answers): hosts only, frozen into the state at start. |
| `game_states` | A game's full state, its round and the settings it started with; written by the engine, read by hosts. |
| `game_player_views` | Each player's private view of a game (a secret task); readable only by that player and hosts. |
| `game_scores` | Points per player from a game's `scores()`. |
| `score_events` | The points ledger: host awards and games' one-off bonuses or penalties. |
| `scoreboard` | View: the day's total per player (`score_events` + `game_scores`). |
| `session_feed` | Announcements from games: a banner on the TV and toasts on phones, or only for some players. |
| `game_prompts`, `game_submissions` | Questions everyone answers from their phone, and one answer per player. |
| `event_log` | Everything that happened, written in the same transaction as the change; hosts only, the raw material of the recap. |
| `session_screens`, `screen_codes` | TVs the host paired with a code: they read what a guest reads and send timer syncs. |
| `player_transfers` | One-off codes to move a player to a new phone. |
| `session_recaps` | The recap the host published. |
| `hosts` | User ids of host accounts. |

`players.profile` and `sessions.data` hold public per-game data, one section per
game type, written through game effects. Uploaded fusion pictures go to the
public `game-media` bucket (hosts upload; JPEG only).

### Pages

| Path                | Who    | What                                                                  |
| ------------------- | ------ | --------------------------------------------------------------------- |
| `/`                 | Anyone | Start page: type a party code, continue, or use a code from the host  |
| `/join/:code`       | Guest  | Join QR target: pick a name                                           |
| `/play/:code`       | Guest  | Points, the games (main card, Also running), Your night, their QR     |
| `/p/:playerCode`    | Anyone | Player QR target: the award page for hosts, into the game for guests  |
| `/tv/:code`         | TV     | The TV: pairs with a code; `?mirror=1` is the host's own TV tab       |
| `/host`             | Host   | Sessions                                                              |
| `/host/s/:id`       | Host   | Control room: on the TV now, live games, the program, players, join   |
| `/host/s/:id/recap` | Host   | The recap of the night: preview, publish, show on the TV, download    |
| `/host/scan`        | Host   | Camera scanner for player QR codes                                    |

## Writing a game

A game is a folder in `src/games/<name>/`. The core never changes for a new
game: everything goes through the SDK in [src/games/core](../src/games/core).
[elimination](../src/games/elimination) (*Last one standing*) is the full example
of a move-based game, [quiz](../src/games/quiz) of one played with prompts, and
[in-person](../src/games/in-person) is the smallest.

**`logic.ts`**: a class extending `Game` from
[src/games/core/Game.ts](../src/games/core/Game.ts). It runs on the server, inside
the engine's one save per request, as pure functions of the state:

| Member | What it does |
| ------ | ------------ |
| `type`, `defaultConfig` | The game's key, and its default settings (public: they ship in the app). |
| `presentation` | `'stage'` (default): Start takes the TV. `'background'`: it runs beside the game on the TV. |
| `parseConfig(input)` | Optional: checks the settings once, at start. Throw `GameError` to refuse. |
| `setup(ctx)` | Deals the initial state when the host starts (or restarts) the game. |
| `parseAction(input)`, `handleAction(state, action, playerId, ctx)` | Checks a move from a phone and applies it. Throw `GameError` to refuse; the message is shown as is. |
| `parseHostAction`, `handleHostAction` | Optional host controls (Next, Reveal, Lock voting). |
| `wakeAt(state, info)`, `onWake(state, ctx)` | Optional timers: when the state wants a sync, and what happens then. |
| `onPlayerJoin`, `onPlayerLeave` | Optional: someone joined or left while the round runs. |
| `isFinished`, `winners`, `onEnd(state, ctx, by)` | Optional: the game finishes itself in the same save; the default winners are the top of this round's points. |
| `scores(state, info)` | Points per player. Added to the day's scoreboard. |
| `publicState(state, info)` | What everyone may see. No secrets. |
| `playerView(state, playerId, info)` | What one player may see, e.g. their own task. |
| `recap(round)` | Optional highlights for the recap, for finished rounds only. |

Every method reads the party through `info` and `ctx`: the session and its
shared data, the players, the day's scoreboard, the settings the round started
with, the database clock (`now`), and this round's prompts and their closed
answers. Hooks also cause effects, saved in the same transaction as the new
state, once per tap even when a phone resends it: `awardPoints`,
`updateProfile`, `updateSessionData`, `announce` (with `detail`, `to`, `sound`,
`icon`, `tone`, and `interrupt` for a winner), `openPrompt`, `closePrompt`,
`revealPrompt` and `record` (a fact for the recap).

The rules:

- Use `ctx.now` and `ctx.random()`, never `Date`, `Math.random` or `crypto`
  (a lint rule checks `logic.ts` and `bot.ts`): a hook may run again when a
  save is retried and must give the same result.
- Never rely on object key order in the state: Postgres (jsonb) reorders keys.
  Keep order in arrays.
- `publicState` and prompt specs are public: never put a secret or an answer
  in them. Show each player theirs in `playerView`.
- Big inputs from everyone (answers, votes) are prompts, never actions: phones
  answer them straight to the database, and the game reads every final answer
  in `info.answers` when it scores them.
- Host actions carry the step they were made for; one whose step has passed
  returns the state unchanged, which the engine answers as skipped.
- `onWake` must move `wakeAt` forward or to null.
- The deciding change announces the result; `onEnd(..., 'game')` stays quiet.
- `recap()` reveals only what the finished round showed the room.

**Screens**, typed against the logic in [src/games/types.ts](../src/games/types.ts),
each optional but the first:

| Screen | Where it shows |
| ------ | -------------- |
| `PlayerView` | The phone's main card: the player's `view`, `myAnswers`, `act(action)` for moves and `submit(key, answer)` for prompts. A game that sets `acceptsScans` also gets guest QR codes scanned with the phone's own camera. |
| `PlayerCard` | A whole compact card while another game holds the main card ("Also running"); `open()` shows the full `PlayerView` in a sheet. |
| `ResultView` | The phone's result card once the game finishes. |
| `HostView` | The game's controls in the host control room, with the full `state`, the `config` and host `act`. |
| `TvView`, `FinalTvView` | The TV stage while live, and its final screen: `lazyScreen(() => import('./TvView'))`, which the TV loads as it opens. Without them the TV shows the standings or a generic winners screen. |
| `TvStatus` | A whole card for the TV's rail while the game runs in the background. |
| `ConfigEditor` | The settings editor, saved to the host-only `game_settings`; it can upload images. |

Shared building blocks: `QrScanner`, `ScanSheet`, `SecretCard` and `PlayerQr`
in [src/components](../src/components).

**`index.ts`**: `defineGameModule({ logic, name, description, icon, PlayerView, ... })`,
with `stageBanners: 'sound-only'` when the `TvView` shows each moment itself,
and `profileBadges` to show the game's profile data as badges. **`bot.ts`**:
the game's rehearsal bot ([src/games/core/bot.ts](../src/games/core/bot.ts)).

**Register** the logic in [src/games/logic.ts](../src/games/logic.ts), the module
in [src/games/registry.ts](../src/games/registry.ts) and the bot in
[src/games/bots.ts](../src/games/bots.ts); `registry.test.ts` checks the lists
match and runs the contract over every game, played by its bot, and
`views.test.ts` renders every view against the sample parties in
[src/lib/fixtures.ts](../src/lib/fixtures.ts). Unit-test the rules with
`createGameContext`, `testInfo` and `answersOf`, play whole rounds through the
real engine step with `simulateParty`, and check the game's own example with
`checkGameContract` (it must include a join and a leave). In dev builds every
screen also opens on a sample party: `/play/x?fixture=<scene>`,
`/tv/x?fixture=<scene>` and, signed in as a host, `/host/s/x?fixture=<scene>`
(the scenes are listed in `fixtures.ts`), and `/dev/tokens` draws the token
sheet ([identity.md](identity.md#the-acceptance-test)).

## Local development

Requires Docker.

```sh
npm install
supabase start                # local Postgres, Auth, Realtime and Storage
cp .env.example .env.development.local  # paste the publishable and secret keys from `supabase status`
npm run dev                   # also serves netlify/functions/* at /api/*
```

```sh
npm test                      # unit tests: the SDK, the engine, the game rules and every screen on sample parties
npm run check                 # types, lint and unit tests
npm run test:integration      # the engine, prompts, secrecy and Realtime against the local stack
npm run db:smoke              # a quick check that the schema, private Realtime and Storage work together
```

`npm run smoke` plays a short round through the real API of any deployment:
a throwaway host, party, three guests and a TV; joining, pairing, pings,
secrets, Last one standing, a quiz to its crown, fusion, an award, moving a
player, the recap, an image upload and unpairing. It deletes everything it
made, even when a step fails. It takes the deployment from the shell, never
from a file:

```sh
API_URL=http://127.0.0.1:54321 PUBLISHABLE_KEY=... SECRET_KEY=... SITE=http://localhost:5173 npm run smoke
```

Against anything but a local stack it also needs `CONFIRM=<project ref>`.

Make yourself a local host: set `DEV_HOST_EMAIL` and `DEV_HOST_PASSWORD` in
`.env.development.local` (local values only) and run `npm run dev:setup`. It
also adds a demo party with 6 guests. Run it again after `supabase db reset`.

The dev server also listens on your LAN IP, so you can open the join page
from a phone. The camera scanner needs HTTPS (or localhost), so test scanning
on the deployed site.

## Production

The app runs on Netlify (the static site plus the two functions) with a
Supabase project. Netlify needs `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`, plus `SUPABASE_SECRET_KEY` as a secret for the
game engine.

Production has run engine v2 since 15 November 2026: its database was wiped
and rebuilt from the one init file, the v2 deploy was published, and
`npm run smoke` passed against it. The git tag `v2-rc1` marks that release and
`v1-final` the v1 release before it. The switch-over is done; its plan stays
in [docs/engine-v2.md](engine-v2.md), section 11, as the record.

Production now holds the party's data, so it is never wiped again. Every
schema change is a new, additive migration file next to the init file in
[supabase/migrations](../supabase/migrations). The new file states its own
grants and ends with a copy of the init file's self-checks
([docs/engine-v2.md](engine-v2.md), section 2.1). Rehearse it locally
first: run `supabase db reset` (it applies the init file and every later file
in order), then `npm run test:integration`. Then back up production (schema,
data and auth users, kept outside the repo) and apply the file with
`supabase db push --linked`, before the deploy that needs it.

Deploy as a draft first: `netlify deploy --build`, without `--prod`. A `POST`
to the draft's `/api/game` without a token must answer 401, which proves the
function bundled and has its environment. Then publish that exact deploy
(Publish deploy on its page in Netlify). When deploying from a copy of the
repo, `node_modules` must be a real directory, never a symlink (`cp -Rc`
clones it fast on macOS). A symlinked `node_modules`, or a stray
`node_modules/node_modules` link inside it, makes Netlify bundle the engine
without its Supabase libraries, and `/api/game` answers 502.

After a deploy, the owner can run `npm run smoke` against it, with the
production values exported in the shell and `CONFIRM=<project ref>`; it cleans
up after itself.

The TV laptop opens `/tv/<join code>` in a browser that has never signed in as
the host, and pairs with the code from Pair a TV on the host page. With no
second device to pair, Show the TV here on the host page opens
`/tv/<join code>?mirror=1` in a tab of the host's own browser: cast that tab,
or move it to the TV as a second screen. A whole-screen mirror shows the
control room too, so then run the party from a phone.

Auth settings were set in the Supabase dashboard (Authentication), not from
`config.toml`: anonymous sign-ins on, anonymous sign-in limit 300/hour
(guests on the same Wi-Fi share one IP), and Site URL = the Netlify URL.
Don't run `supabase config push`: it would overwrite them with the local values.

From Friday 20 November to Sunday 29 November 2026, the Auth limits are
raised in the dashboard for the party: anonymous sign-ins 3,600 per hour,
token refreshes 1,000 per 5 minutes, sign-ups and sign-ins 300 per 5 minutes,
and an access token lifetime of 12 hours. After the party all four go back to
their everyday values (anonymous sign-ins 300 per hour, as above, and a token
lifetime of 1 hour).

To add a host, create the user under Authentication → Users → Add user (tick
*Auto confirm*), then run this in the SQL editor:

```sql
insert into public.hosts (user_id)
select id from auth.users where email = '<their email>';
```

## Sound effects

The sound effects were generated with [ElevenLabs](https://elevenlabs.io) from
the prompts in [src/games/core/sounds.ts](../src/games/core/sounds.ts). The
current set is final: don't regenerate it, since each run of
`npm run sounds -- <name>` replaces that sound's file in
[public/sounds](../public/sounds) with a new, different take.
