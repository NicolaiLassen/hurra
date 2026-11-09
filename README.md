<p align="center">
  <img src="public/icon-512.png" alt="" width="112" height="112">
</p>

<h1 align="center">Hurra</h1>

<p align="center">
  Live party games for a room full of friends. Guests play on their phones,
  a TV runs the show, and every game is a plugin on a homemade engine.
</p>

<p align="center"><em>Named after the Danish birthday cheer: Hurra, hurra, hurra!</em></p>

<p align="center">
  <img src="docs/screenshots/tv-game.png" alt="The TV during the quiz: question 1 revealed with 34 of 50 right, the day's top 5 and Last one standing running beside it" width="900">
</p>

<p align="center">
  <img src="docs/screenshots/phone-game.png" alt="A guest's phone during the quiz, with their answer locked in and the countdown bar" width="240">
  &nbsp;
  <img src="docs/screenshots/phone-scan.png" alt="The knockout dialog after scanning another guest's code: they did my task, or I caught them trying theirs" width="240">
  &nbsp;
  <img src="docs/screenshots/host-session.png" alt="The host control room: what is on the TV, the live quiz with its answered count, Last one standing in the background and the players" width="320">
</p>

Built for one particular night: a 30th birthday party on 28 November 2026,
with about 45 guests, one host and one TV. There is nothing to install. Guests
scan a QR code, pick a name and they're in.

## How a party works

- **Guests** scan the join QR on the TV and pick a name. Their phone remembers
  them, so closing the tab is fine: they come back as the same player. Every
  guest also has a personal QR code, used for scoring things that happen in
  the room. A guest on a new phone gets their player back with a code from
  the host.
- **The host** runs the party from a laptop or a phone: opens joining, adds and
  starts games (on the TV or in the background), moves the night along, and
  gives points by scanning a guest's code. At the end, the host publishes a
  recap of the night.
- **The TV** is a laptop the host pairs with a code: it reads what a guest
  reads, never more. It shows the day's leaderboard and the join QR. A game
  started on the TV takes the stage, with the games running in the background
  as cards beside it. A game that finishes gets a final screen for 3 minutes,
  and at the end the TV plays the recap.

## Games

Several games run at once: a long one in the background while short ones
take the TV. A game finishes by itself in the moment it has its winner; the
host can always end one early.

- **Last one standing**, all night long, in the background. Everyone gets a
  secret task and one life. Get someone to do your task and they're out (their
  task becomes yours), or catch someone trying theirs on you. Scan their code
  to knock them out; the TV keeps count of who is still standing, and the last
  one standing wins.
- **Quiz**, on the TV. The host runs the questions, everyone answers on their
  phone, and right answers score more the faster they come. Time's up reveals
  the answer, a leaderboard follows, and the host crowns the winner.
- **Participant fusion.** AI images fuse two guests into one portrait, printed
  and hung on the wall. Guests vote on their phones for who is in each picture;
  the host locks voting and reveals the pictures one by one on the TV.
- **In-person round.** The host gives points by hand for anything that happens
  in the room, by scanning the guest's code.

<p align="center">
  <img src="docs/screenshots/tv-45-guests.png" alt="The TV's standings with 50 guests: the podium, Last one standing running beside it, and the finished quiz and fusion as chips" width="900">
</p>

How every screen connects, for guests, the host and the TV:
[docs/user-flows.md](docs/user-flows.md).

## How it fits together

- **Frontend:** React + Vite + Tailwind + [shadcn/ui](https://ui.shadcn.com),
  hosted on Netlify as a single-page app. shadcn components live in
  [src/components/ui](src/components/ui) and are ours to edit; add more with
  `npx shadcn@latest add <component>`. The theme (dark, gold primary) is the
  CSS variables in [src/index.css](src/index.css).
  Icons are [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`,
  bold by default via `IconContext` in [src/main.tsx](src/main.tsx)). The
  TV animates with `motion`, loaded only on the TV page and the games' TV
  screens, so phones never download it. The app icon is
  [public/favicon.svg](public/favicon.svg); the PNGs next to it are rendered from it.
- **Backend:** Supabase, plus one Netlify Function for game logic. The design
  doc is [docs/engine-v2.md](docs/engine-v2.md).
  - **Postgres** holds parties, players, games and their state, the points
    ledger and an event log of the whole night, all from one init file
    ([supabase/migrations](supabase/migrations)) that checks its own grants
    and policies and aborts if one is missing.
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
  - [game](netlify/functions/game.mts) (`POST /api/game`) is the game engine
    ([netlify/lib/engine.ts](netlify/lib/engine.ts)): two database round trips
    per request, `game_load` then `game_commit`, around the pure `step()` in
    [src/games/core/runtime.ts](src/games/core/runtime.ts). It runs with the
    Supabase secret key, so players can't cheat and games can keep secrets.
  - [keep-alive](netlify/functions/keep-alive.mts) runs daily and calls
    `rpc/keep_alive`, because free Supabase projects pause after a week
    without activity (the app then can't log anyone in).

### Data model

| Table | What it is |
| --- | --- |
| `sessions` | A party. `join_code` is in the join QR; `status` open/closed controls joining; `spotlight_game_id` is the game on the TV. |
| `players` | A guest in a party, tied to their auth user. `code` is in their personal QR. |
| `session_games` | A game in a party: `game_type` picks the plugin, `public_state` is what everyone sees, `wake_at` when it wants a timer sync. Several can be `active` at once. |
| `game_settings` | A game's settings (quiz questions and answers): hosts only, frozen into the state at start. |
| `game_states` | A game's full state, its round and the settings it started with; written by the engine, read by hosts. |
| `game_player_views` | Each player's private view of a game (a secret task); readable only by that player. |
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
| `/tv/:code`         | TV     | The TV: pairs with a code from the host page, then shows the party    |
| `/host`             | Host   | Sessions                                                              |
| `/host/s/:id`       | Host   | Control room: on the TV now, live games, the program, players, join   |
| `/host/s/:id/recap` | Host   | The recap of the night: preview, publish, show on the TV, download    |
| `/host/scan`        | Host   | Camera scanner for player QR codes                                    |

## Writing a game

A game is a folder in `src/games/<name>/`. The core never changes for a new
game: everything goes through the SDK in [src/games/core](src/games/core).
[elimination](src/games/elimination) (*Last one standing*) is the full example
of a move-based game, [quiz](src/games/quiz) of one played with prompts, and
[in-person](src/games/in-person) is the smallest.

**`logic.ts`**: a class extending `Game` from
[src/games/core/Game.ts](src/games/core/Game.ts). It runs on the server, inside
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

**Screens**, typed against the logic in [src/games/types.ts](src/games/types.ts),
each optional but the first:

| Screen | Where it shows |
| ------ | -------------- |
| `PlayerView` | The phone's main card: the player's `view`, `myAnswers`, `act(action)` for moves and `submit(key, answer)` for prompts. A game that sets `acceptsScans` also gets guest QR codes scanned with the phone's own camera. |
| `PlayerCard` | A whole compact card while another game holds the main card ("Also running"); `open()` shows the full `PlayerView` in a sheet. |
| `ResultView` | The phone's result card once the game finishes. |
| `HostView` | The game's controls in the host control room, with the full `state`, the `config` and host `act`. |
| `TvView`, `FinalTvView` | The TV stage while live, and its final screen (load them lazily). Without them the TV shows the standings or a generic winners screen. |
| `TvStatus` | A whole card for the TV's rail while the game runs in the background. |
| `ConfigEditor` | The settings editor, saved to the host-only `game_settings`; it can upload images. |

Shared building blocks: `QrScanner`, `ScanSheet`, `SecretCard` and `PlayerQr`
in [src/components](src/components).

**`index.ts`**: `defineGameModule({ logic, name, description, icon, PlayerView, ... })`,
with `stageBanners: 'sound-only'` when the `TvView` shows each moment itself,
and `profileBadges` to show the game's profile data as badges. **`bot.ts`**:
the game's rehearsal bot ([src/games/core/bot.ts](src/games/core/bot.ts)).

**Register** the logic in [src/games/logic.ts](src/games/logic.ts), the module
in [src/games/registry.ts](src/games/registry.ts) and the bot in
[src/games/bots.ts](src/games/bots.ts); `registry.test.ts` checks the lists
match and runs the contract over every game, played by its bot, and
`views.test.ts` renders every view against the sample parties in
[src/lib/fixtures.ts](src/lib/fixtures.ts). Unit-test the rules with
`createGameContext`, `testInfo` and `answersOf`, play whole rounds through the
real engine step with `simulateParty`, and check the game's own example with
`checkGameContract` (it must include a join and a leave). In dev builds every
screen also opens on a sample party: `/play/x?fixture=<scene>`,
`/tv/x?fixture=<scene>` and, signed in as a host, `/host/s/x?fixture=<scene>`
(the scenes are listed in `fixtures.ts`).

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

The database is built from the one init file. Moving production from v1 to v2
is a wipe and rebuild, with its exact steps and checks in
[docs/engine-v2.md](docs/engine-v2.md), section 11. After a deploy, the owner
can run `npm run smoke` against it, with the production values exported in the
shell and `CONFIRM=<project ref>`; it cleans up after itself.

The TV laptop opens `/tv/<join code>` in a browser that has never signed in as
the host, and pairs with the code from Pair a TV on the host page.

Auth settings were set in the Supabase dashboard (Authentication), not from
`config.toml`: anonymous sign-ins on, anonymous sign-in limit 300/hour
(guests on the same Wi-Fi share one IP), and Site URL = the Netlify URL.
Don't run `supabase config push`: it would overwrite them with the local values.

To add a host, create the user under Authentication → Users → Add user (tick
*Auto confirm*), then run this in the SQL editor:

```sql
insert into public.hosts (user_id)
select id from auth.users where email = 'you@example.com';
```

## Credits

- Sound effects generated with [ElevenLabs](https://elevenlabs.io); the
  prompts are in [src/games/core/sounds.ts](src/games/core/sounds.ts) and
  `npm run sounds` makes new ones.
- Icons by [Phosphor](https://phosphoricons.com), components from
  [shadcn/ui](https://ui.shadcn.com), type in [Geist](https://vercel.com/font).
