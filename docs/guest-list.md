# The guest list

Before the party the host adds every guest's name in the control room, one at
a time or as a pasted list. A guest who joins taps their name under "Who are
you?" instead of typing it. Game settings can name guests who have not joined
yet, so the host sets up fusion's pictures (and the photo and song game's
photos and "Doesn't play this game") at home. Everywhere guests play, only
guests who have joined count: a name on the list that never joined never
appears on the TV, on a phone, in a game, in the standings or in the recap.

Why, in the owner's words about Participant fusion's "Who is in it?" picker,
which listed only guests who had joined: "I need to add my guests beforehand,
so when they join they can select their name, and then I can use it here.
Else I cannot set the game up."

Built 25 and 26 November 2026 on `guests/list`, for the party on Saturday 28
November (about 24 guests, built for 45). The contracts it changes are in
[engine-v2.md](engine-v2.md), marked "Changed after the switch-over (26
Nov)"; the screens are in [user-flows.md](user-flows.md). Every name here is
invented: Ana, Bo, Mads and Sofie from the fixtures, and Zelda, Quentin,
Ximena and Ulrik for guests still expected.

**Contents:** [1. Decisions](#1-decisions-at-a-glance) ·
[2. The model](#2-the-model) · [3. The database](#3-the-database) ·
[4. The SDK and the engine](#4-the-sdk-and-the-engine) ·
[5. Where only joined guests count](#5-where-only-joined-guests-count) ·
[6. The join flow](#6-the-join-flow-screen-by-screen) ·
[7. The host's guest list](#7-the-hosts-guest-list-screen-by-screen) ·
[8. Freeing and removing](#8-freeing-and-removing-end-to-end) ·
[9. What each game must do](#9-what-each-game-must-do-with-expected-guests) ·
[10. The settings plumbing](#10-the-settings-plumbing-and-fusions-editor) ·
[11. Fixtures, tests, smoke](#11-fixtures-tests-smoke) ·
[12. Applying the migration](#12-applying-the-migration) ·
[13. Risks and known limits](#13-risks-and-known-limits)

---

## 1. Decisions at a glance

| Question | Decision |
| --- | --- |
| What is a guest on the list? | A `players` row the host made, with `user_id` null. Its id is the guest's id from the list to the night, so settings can store it. |
| How is "joined" told apart? | The public column `players.joined_at`: null while expected, the join time once taken. Rows from before the migration got their `created_at`. The check `players_joined` keeps `(user_id is null) = (joined_at is null)`. No user id ever reaches a client. |
| Where is "only joined guests" enforced? | At the source, in the database: `session_snapshot` (players, standings), the `scoreboard` view, `game_load`, `game_commit`, `check_answer`, `session_recap`, the members' read policy on `players` and the host award policy on `score_events`. Every screen and every game keeps reading what it read before, and sees only joined guests. |
| Who sees expected guests? | Hosts: the snapshot's `guests` (host page only), `info.guests` in game logic, `guests` in a settings editor and a host view. Anyone with the join code: the free names only (`guest_list`), nothing else about them. |
| How does a guest take a name? | `claim_guest(join code, name)`: by name, so no id or code of an expected guest leaves the database to someone who isn't in the party. One atomic `update ... where user_id is null`. |
| A typed name that matches a free name? | `join_session` refuses with `on_list` (the listed name in HINT); the phone offers "Yes, I'm Ana", which takes it. Never taken silently. |
| Joining rules | Taking a name is joining: the party must be open and not archived; one player per user per party; `clean_name`, `name_key` and the look-alike rules hold across joined and expected names alike. |
| Freeing a name | `host_free_guest`: the row is deleted and put back with the same id, name and `created_at`, a new player code, and `user_id` and `joined_at` null. Everything the taker earned goes through the foreign key cascades. One `player.freed` log row, one room ping. |
| How does the freed phone know? | The snapshot's `freed` (like `moved`), from `my_exit`, the newest way this user's player left the party. The phone goes straight back to Who are you?. |
| Freed and taken again during a live round | The engine sees it (the player's `joined_at` is later than the game's last save) and runs `onPlayerLeave` then `onPlayerJoin` for that id, so the new person never inherits the old one's round. |
| Answers that name guests | `options: 'players'` stays "joined guests". New: `options: 'guests'`, every name on the list, joined or not, so a vote can name a guest who never came. |
| Adding names | An RPC, `host_add_guests`: clients may never insert into `players`. Rename and remove of an expected guest use the host's direct update and delete. |
| Caps | 100 names per Add, 200 expected names per party, names 1 to 40 characters after `clean_name`. |
| A party without a list | Behaves exactly as before: no free names means the join page shows the name form. If `guest_list` fails or is missing (an older database), the name form too. |
| The SDK | `GameGuest = { id, name, joined }`; `GameInfo.guests` (required); `ConfigEditorProps.guests` and `HostViewProps.guests`. `players` stays what it was everywhere: joined guests. |
| Where the host sees it | The Guest list card under Players in the control room (expected names, Add guests, Rename, Remove from the list), and Free the name in each player's menu. |

---

## 2. The model

```
host adds "Ana"           a guest taps "Ana"              host frees "Ana"
players row X             players row X                   players row X (deleted, put back)
  user_id   null    -->     user_id   <their user>  -->     user_id   null
  joined_at null            joined_at now()                 joined_at null
  name      Ana             name      Ana                   name      Ana
  code      K7Q2M           code      K7Q2M                 code      <new>
```

- A guest who was never on the list joins with `join_session` exactly as
  before: a row with `user_id` and `joined_at` set at once.
- Every row is "on the list": an expected guest, or a joined guest (listed
  first or not). Freeing a joined guest who typed their own name puts that
  typed name on the list as expected.
- Names are unique per party across all rows (the `players_session_name_key`
  index on `name_key(name)`), so "Ana" can be on the list once, and a phone
  typing "ANA", or Ana with a Cyrillic A, meets the listed Ana.

---

## 3. The database

One additive migration,
[supabase/migrations/20261126000000_guest_list.sql](../supabase/migrations/20261126000000_guest_list.sql),
by the rules of [engine-v2.md, 2.1](engine-v2.md#21-rules-for-the-file):
`set search_path = ''` and fully qualified names, security definer only to
pass row level security (owned by postgres), every function revoked and
granted exactly, custom SQLSTATEs with the machine code in DETAIL, and the
self-check block at the end, which is now the current one. It sets
`lock_timeout` to 5 s first and holds no data.

It is safe on production with today's data (every existing row gets
`joined_at = created_at`, nothing else changes) and while the old app is live
for a few minutes: old code never makes a row without a user (`joined_at`
defaults to `now()` for its inserts), and every replaced function keeps its
signature and returns a superset, the same as before for a party without a
list.

### 3.1 Columns, constraint, index

- `players.user_id` may be null. `unique (session_id, user_id)` stays: nulls
  are distinct, so a party can have many expected rows and a user still has at
  most one row per party. `on delete cascade` from `auth.users` stays.
- `players.joined_at timestamptz`, default `now()`, so every insert with a user
  (join_session, the test helpers, the scripts with the secret key) is joined
  at once. A row without a user must pass `joined_at => null`, or the check
  `players_joined` refuses it.
- `players_expected_idx` on `(session_id) where user_id is null`: the free
  names of a party.

### 3.2 Grants and the read policy

The players' grants are stated again exactly, so `joined_at` (like `user_id`)
is in no client write grant: authenticated may select and delete (the policies
make both the host's), and update `name` only. Members (guests and paired TVs)
read only joined rows; hosts read every row (the guest list, rename and
remove):

```sql
alter policy "Hosts and members read players" on public.players
  using ((select public.is_host())
         or (session_id = any ((select public.my_session_ids())::uuid[]) and joined_at is not null));
```

A host gives points (the award page's direct insert into `score_events`) only
to a guest who joined, as `game_commit` does. Without it, an award racing a
free (from a second host device) would land on a name still waiting on the
list: its id would reach every screen in the snapshot's `game_points`, and
whoever took the name next would get the points.

```sql
alter policy "Hosts give points" on public.score_events
  with check ((select public.is_host())
              and exists (select 1 from public.players p where p.id = player_id and p.joined_at is not null));
```

### 3.3 The scoreboard view

The view gains `where p.joined_at is not null`, same columns. That covers the
snapshot's standings, `game_load`'s scoreboard, `session_recap`'s standings and
the host's own direct reads.

### 3.4 `my_exit(p_session_id)`

Stable, definer, for authenticated and service_role. The kind of the newest of
this user's `player.moved`, `player.freed` and `player.removed` rows in the
party (by `data.from_user`), or null. The snapshot reads `moved` and `freed`
from it, so a guest removed after an earlier move reads as removed, not moved.
`moved_away` stays for anything that calls it.

### 3.5 The players trigger and the log

`log_player_change` (the `players_logged` trigger) is replaced. It still fails
open, stays quiet while `hurra.engine` is on, and is quiet for the row
`host_free_guest` is putting back (`hurra.freeing` names it).

| Change | Log row | Ping |
| --- | --- | --- |
| Insert without a user (`host_add_guests`) | `guest.added` `{ name, player_id }`, actor host | stage |
| Insert with a user (`join_session`) | `player.joined` as before | stage |
| Rename of an expected row | `guest.renamed` `{ name, player_id, from }` | stage |
| Rename of a joined row | `player.renamed` as before | room |
| `user_id` from null to a user (`claim_guest`, or a host's move code used on an expected row) | `player.joined` `{ name, player_id, listed: true }`, actor player | stage |
| `user_id` from a user to null (no app path; a script might) | `player.freed` with `from_user` | room |
| `user_id` from one user to another (`claim_player`) | `player.moved` as before | room |
| Delete of an expected row | `guest.removed` `{ name, player_id }` | stage |
| Delete of a joined row | `player.removed` as before, now with `from_user` | room |

Pings to stage reach the host page (and the TV, which ignores them). Phones are
never pinged for list changes: they never show expected guests.

### 3.6 `join_session`

Same signature and return. After the name check, a typed name whose `name_key`
matches a free listed name is refused: `PT409 on_list`, "\"Ana\" is on the
guest list. If that's you, pick it from the list.", with the listed name in
HINT. A clash on the name index with a row the host listed in between gives
the same `on_list`; with a joined row, `name_taken` as before. Everything else
is unchanged, so a party without a list joins exactly as before.

### 3.7 `guest_list(p_join_code)`

Stable, definer, for authenticated and service_role (not anon). The free names
of the party as a JSON array of strings, in name order: no id, no code, no
times. Null when signed out or for an unknown code; `[]` while joining is
closed or the party is over (nobody may take a name then). The phone sorts
them itself, the Danish way.

### 3.8 `claim_guest(p_join_code, p_name)`

Volatile, definer, for authenticated and service_role. Taking a name is
joining. In order: signed in, the party exists; this user already in the
party returns their player when it is the same name (a retry), else
`already_player`; archived, closed, a blank name; then one atomic
`update ... set user_id = <caller>, joined_at = now() where user_id is null and
name_key(name) = <key>`. A second phone tapping the same name waits on the row
lock, then updates nothing and gets `guest_taken`. If the name was freed while
it waited (deleted and put back), it tries once more. One browser taking two
names at once in two tabs gets one of them; the other call sees its own player.
The update waits for a running `game_commit`, as `claim_player` does.

### 3.9 `host_add_guests(p_session_id, p_names text[])`

Volatile, definer, for authenticated and service_role. Hosts only. Up to 100
names a call. Each name is cleaned; a blank line is skipped without a word; a
name over 40 characters is skipped as `too_long`, one repeated in the same
call as `repeat`, one already in the party (joined or expected, look-alikes
included) as `taken`. If the party's expected names plus the new ones would
pass 200, nothing is added (`list_full`, whose words say how many more fit).
Each row is stamped a moment apart (`clock_timestamp()`), so the list keeps the
order the names were pasted in. Returns `{ "added": [{ id, name }], "skipped":
[{ name, reason }] }`, names as stored for added ones and as given for skips,
in input order.

### 3.10 `host_free_guest(p_player_id)`

Volatile, definer, for authenticated and service_role. Hosts only. Locks the
row; deletes it, which takes everything the taker earned with it through the
foreign keys (`score_events`, `game_scores`, `game_player_views`,
`game_submissions`, `player_transfers`, and any later table that cascades);
puts it back with the same id, name and `created_at`, a new player code, no
profile and no photo; drops the taker from targeted announcements (and deletes
those left with nobody); logs one `player.freed` (actor host, `from_user`);
pings the room. Returns `{ id, name, previous_photo }` so the host page deletes
the file. The delete waits for a running `game_commit`.

### 3.11 The other replaced functions

- `claim_player`: sets `joined_at = coalesce(joined_at, now())`, so a host's
  move code issued for an expected guest joins the phone that uses it instead
  of breaking the check. The room never offers that, but the RPC takes any id.
- `check_answer`: `options: 'players'` counts joined guests only; `'guests'`
  accepts every row of the party, joined or not; `exclude_self` works for both.
- `session_snapshot`: `players` are joined guests in join order, each with
  `joined_at`; standings come from the filtered view; the new `guests` key
  holds every row `{ id, name, joined_at, created_at }`, by name, for a host on
  the host screen only (null everywhere else); the new `freed` is true for a
  phone whose player the host freed and that is not in the party.
- `session_recap`: players are joined guests with their join time, so the
  recap's guest count is the guests who came.
- `game_load`: `players` are joined guests in join order with `joined_at`;
  new `guests` (every row, `{ id, name, joined }`, in the order they were
  added); `current.saved_at`, the time of the game's last save.
- `game_commit`: each of its six joins and filters on `players` gains
  `joined_at is not null`, so a request that loaded before a free and commits
  after it writes no view, score, bonus, badge or toast for that id.

### 3.12 Refusals

| Function | Code | Words |
| --- | --- | --- |
| `join_session` | `PT409 on_list` | "Ana" is on the guest list. If that's you, pick it from the list. (HINT: Ana) |
| `claim_guest` | `PT409 guest_taken` | Someone just took Ana. If that's you, ask the host to free your name. |
| `claim_guest` | `PT404 not_on_list` | Ana isn't on the guest list any more. Pick your name again. |
| `claim_guest` | `PT409 already_player` | This phone is already in the party as Bo |
| `claim_guest` | `PT409 closed`, `PT409 archived`, `PT400 bad_name`, `PT404 not_found`, `PT401 not_signed_in` | as `join_session` |
| `host_add_guests` | `PT403 not_host`, `PT404 not_found`, `PT409 archived` | Only hosts can do that; Party not found; This party is over |
| `host_add_guests` | `PT400 too_many` | Add at most 100 names at a time |
| `host_add_guests` | `PT409 list_full` | The guest list holds at most 200 names that haven't joined yet. 4 more fit. |
| `host_free_guest` | `PT403 not_host`, `PT404 not_found` | Only hosts can do that; That guest isn't in the party any more |
| `host_free_guest` | `PT409 not_joined` | Ana is already free |

### 3.13 Self-checks

The guest photos file's block, copied whole, plus: `players.joined_at` in no
client insert or update grant; the new functions exist and authenticated and
service_role may run them; the `players_joined` check and the column exist;
the members' policy, the host award policy, the scoreboard view, `session_snapshot`, `game_load`,
`check_answer` and `session_recap` carry the `joined_at is not null` filters,
and `game_commit` at least six times; the snapshot still carries the photos
and sound volume keys and now `'guests'` and `'freed'`; the `players_logged`
trigger is enabled. A later file that replaces one of these from an older copy
fails its own copy of this block instead of quietly showing expected guests to
the room.

---

## 4. The SDK and the engine

### 4.1 `src/games/core/Game.ts`

```ts
/** A name on the party's guest list: a guest who joined, or one the host listed who hasn't yet. */
export type GameGuest = {
  readonly id: PlayerId
  readonly name: string
  /** True once they joined: then they are in info.players too. */
  readonly joined: boolean
}
```

- `GameInfo.guests: readonly GameGuest[]` (required): everyone on the guest
  list, joined or still expected, for names and settings only. Only
  `info.players` play: effects, scores and views for anyone else are dropped.
- `GameInfo.players`: unchanged in meaning, the guests who joined.
- `PromptSpec` choice `options: readonly string[] | 'players' | 'guests'`.
  `'players'`: the ids of the joined players at the moment of answering.
  `'guests'`: every name on the list, joined or not. `exclude_self` works with
  both.
- `onPlayerLeave` also runs for an id the host freed and someone took again: it
  leaves (as the old person) and joins (as the new one) in the same save.

### 4.2 `src/games/core/runtime.ts`

- `Loaded.players` may carry `joined_at`, `Loaded.guests` and
  `Loaded.current.saved_at` are optional, so a database without the migration
  still loads. `info.players` never carries `joined_at`. `info.guests` is
  `loaded.guests`, or the players as joined when it is absent.
- **Re-join detection:** a present id that is in the game's members and whose
  `joined_at` is later than `current.saved_at` was freed and taken again since
  the last save. It is added to both `left` and `joined`: the leave hooks run
  in a context whose `info.players` lacks it (so their effects aimed at it are
  dropped, as for anyone who left), then the join hooks with the full info.

### 4.3 Testing helpers

- `testInfo(config, playerIds, overrides)` gives `guests`: the players, all
  joined, unless `overrides.guests` names expected guests too.
- `simulateParty` mirrors the database: `listGuest(name)`, `claimGuest(id)`,
  `freeGuest(id)` and `guestList()`, the load's `guests`, each player's
  `joined_at` and the state's `saved_at`, and `'guests'` answers.

### 4.4 `src/games/types.ts`

- `ConfigEditorProps.guests: readonly GameGuest[]`: everyone on the guest list,
  joined or still expected, so settings can name guests before they come.
  `players` is the joined ones.
- `HostViewProps.guests: readonly GameGuest[]`: the same, for the host's
  controls on the night (fusion's Show who).
- No other screen gets the guest list: phones and the TV know only joined
  players, so a game shows an expected guest's name from its own public state.

### 4.5 The client (`src/lib`)

- `types.ts`: `Player.joined_at?`, `ListedGuest = { id, name, joined_at | null,
  created_at }`, `Snapshot.guests?` and `Snapshot.freed?` (optional, so other
  branches' fixtures compile).
- `live.ts`: `freed` is set like `moved`; the host page's fingerprint follows
  the guest list, so a change to it redraws the room.
- [src/lib/guestList.ts](../src/lib/guestList.ts), pure: `namesFromText` (one
  name per line, list marks and blank lines dropped, repeats counted by the
  folded name, at most 100 with the rest kept), `sortNames` (Danish: Æ, Ø and
  Å after Z), `matchNames` (folded, so "soren" finds Søren), `guestsOf(snapshot)`
  (the snapshot's guests as `GameGuest`, or the players as joined on an older
  database) and `listCounts`.
- `queries.ts`, the guest side: `freeGuestNames` (`[]` on any failure, so the
  page falls back to the name form), `claimGuest`, `joinSession`'s `OnListError`
  with `listedName`, and `getPlayerByCode`, which never opens an expected row
  for a host.
- `queries.ts`, the host side: `addGuests(sessionId, names)`;
  `freeGuest(sessionId, playerId)` (the photo first with `host_remove_photo` and
  the guest's folder, best effort; then `host_free_guest`; then any
  `previous_photo` it returns; then a sync to every live game, as
  `removePlayer` does, where a failed sync is not an error); and
  `removeGuest(playerId)`, a delete of that row only while `joined_at` is null,
  so it never removes a guest who joined a moment before.
- `recap.ts`: a `player.freed` row drops that id's running total, as
  `player.removed` does.

---

## 5. Where only joined guests count

The database filters at the source (3), so these read only joined guests
without a change of their own:

- **Phones:** the phone home's lobby faces and "N players here", my place,
  the standings, Finished lately, Your night, every game's view.
- **The TV:** the board and its tiers by count, the header and strip, the
  winner's screen, the band, the recap's slides.
- **The host room:** the header's "12 guests, joining is open", Players (n),
  the award page (`getPlayerByCode` skips expected rows, and the database
  refuses an award to one), the move dialog,
  the recap preview.
- **Games:** `info.players`, Last one standing's dealing, the quiz's answered
  counts, `scores`, `recap()`'s `round.players`; any view, score, point, badge,
  toast or answer for anyone else is dropped by the engine and `game_commit`.

---

## 6. The join flow, screen by screen

All on `/join/:code` ([src/pages/Join.tsx](../src/pages/Join.tsx),
[joinScreen.ts](../src/pages/joinScreen.ts),
[WhoAreYou.tsx](../src/components/phone/WhoAreYou.tsx)). Phone copy: no
exclamation marks, the phone's `xl` buttons, one gold step per screen. Before
"joining is open" nothing changed: the busy screen, Party not found, This
party is over, Joining is closed (polls every 5 s), Got a code from the host.

### 6.1 Which screen

When joining is open, the page asks for the free names (the loader while they
load, read again every 15 s while the list shows, so names others took drop
out):

- Names come back: **Who are you?** (6.2).
- No names, an error, or no such function: **the name form** (6.4), exactly
  as before. A party without a list is unchanged.

When Joining is closed sees the party open, it goes through the same choice.

### 6.2 Who are you?

- No logo: **"You're joining Birthday party"** on one small line in paper-2,
  so an iPhone SE with Safari's bars showing (375 x 548) fits 4 names above
  the bottom bar, where it fitted 2.
- For a phone just freed (6.6), a solid note with `ArrowUUpLeftIcon`: **"The
  host gave the name Ana back to the list. Pick your own name."**
- **"Who are you?"** (the page's heading), under it **"Tap your name. Taken
  names aren't shown."** (one line at 375 px), so a guest whose name someone
  else took knows why it is missing.
- From 9 names, a search sticky at the top of the list: **"Find your name"**,
  folded ("soren" finds Søren). No match: **"No free name matches “mads”. If
  someone took yours, ask the host to free it."**, and 0.4 s later the list is
  read again, so a name the host just added shows at once instead of on the
  next 15 s read.
- The names, sorted the Danish way, each a full-width row at least 56 px tall
  with the guest's 40 px token and the name, truncated on one line. A tap
  opens 6.3.
- Sticky at the bottom in the thumb zone: the `secondary` **"I'm not on the
  list"** with `UserPlusIcon`, which opens 6.4 with a way back.
- Under the list: **"Got a code from the host?"**, as before.

No gold button on this screen: the rows are the action.

### 6.3 You're Ana?

Its own screen: the 128 px token (which shows the whole first name),
**"You're Ana?"**, **"Everyone sees you as Ana tonight: on the TV, in the
games and in the standings."**, the gold **"Yes, I'm Ana"** (**"Joining…"**
while it sends), and the ghost **"No, go back"** (the search kept). On success:
remember the join code, the Add a photo step, then `/play/:code`, exactly as
after a typed join.

| Refusal | What the phone does |
| --- | --- |
| `guest_taken` | Back to 6.2, the list read again, with the note "Someone just took Ana. If that's you, ask the host to free your name." |
| `not_on_list` | Back to 6.2, read again, with "Ana isn't on the guest list any more. Pick your name again." |
| `already_player` | Reads the membership again and goes to `/play/:code`. |
| `closed`, `archived` | Reads the party again: Joining is closed, or This party is over. |
| busy sign-in (429) | The calm busy message under the button, as the name form does. |
| anything else | The error's words under the button; the screen stays. |

### 6.4 The name form

The name form as before ("What should we call you?", the live token preview,
"Let's go", "Got a code from the host?"), plus **"Back to the list"** above
it when the guest came from 6.2, and the freed note when it applies. For
`name_taken` the database's "Someone already joined as "Mads Holm". Try
another name." gets a hint in paper-2 for both ways it can be you: **"Is that
you? Ask the host. If someone else took your name, they can free it. If you
joined on another phone, they can give you a code to move here."** "Got a code
from the host?" stays under the form as the way to enter the code, so Let's go
stays the one gold step. (Before, the hint sent every such guest to a move
code, which hands the real guest the photo and points of whoever took the
name.)

### 6.5 A typed name that is on the list

`joinSession` refuses with `OnListError`. In place of the error line, in
paper-2 since nothing is wrong: **"Ana is on the guest list."**; the gold
button becomes **"Yes, I'm Ana"**, which takes the name with the refusals of
6.3, and the token beside the field becomes Ana's (the one about to be taken,
not the typed "ana"); under it **"Not you? Change the name, for example with the first letter
of your last name."** Editing the name brings back "Let's go". A typed name
that matches a name already taken gives `name_taken` with the hint of 6.4.

### 6.6 A phone whose name was freed

The phone home's not-in-party screen with `freed` sends the phone to
`/join/:code` with the name in the router state, so the page shows the note of
6.2 (or on the form). If joining is closed then, the phone shows Joining is
closed and lets the guest in when the host opens it (the host's confirm says
so, 7.5). A freed phone that reloads reaches the join page without the router
state: no note, and the name is on the list again either way.

### 6.7 Dev fixture

In dev builds, `/join/x?fixture=guests` shows 6.2 with 16 invented names and no
network, `&names=45` for 45, `&freed=Ana` for the note. A tap shows 6.3, and
"Yes" shows "Sample party: nothing was sent".

---

## 7. The host's guest list, screen by screen

The control room (`/host/s/:id`), the right column: the join card, Players,
then the **Guest list** card; on a phone, Players, Guest list, then the join
card last. Host room rules: a raised card with no hairline, states as words,
no gold here (the program's Start keeps the room's gold).

### 7.1 The Guest list card

[src/components/host/GuestListPanel.tsx](../src/components/host/GuestListPanel.tsx),
its words in [guestListWords.ts](../src/components/host/guestListWords.ts).

- Title **"Guest list"**, and at its right the `secondary` **"Add guests"**
  with `UserPlusIcon` (not on an archived party).
- The line under the title:
  - while the host has listed nobody (an empty list, or only guests who typed
    their names): **"Add the guests you invited. When they join, they tap
    their name instead of typing it, and you can name them in a game's
    settings before they arrive."** A listed name is one still expected, or
    taken later than its row was made (`wasListed` in
    [src/lib/guestList.ts](../src/lib/guestList.ts)); a typed join's row is
    made and joined at the same moment;
  - otherwise **"12 of 30 here. 18 still expected."**;
  - nobody expected, once the host listed names: **"Everyone on the list is
    here."**
- When guests are expected: from 9 of them a search, **"Find a name on the
  list"** (no match: **"Nobody called “Ulr” on the list."**); the heading
  **"Still expected (18)"**; a row per guest, sorted the Danish way, with the
  28 px token and the name in bold, and a menu (**"More actions for Zelda"**):
  **"Rename…"** and, after a separator, **"Remove from the list…"**
  (destructive).
- Under the rows, from 2 expected and not on an archived party, the ghost
  **"Remove everyone still expected…"** (`UsersThreeIcon`): a paste that went
  wrong is undone in one step. Its confirm: **"Remove everyone still
  expected?"**, **"The 18 names nobody has taken yet leave the guest list, and
  game settings that name them lose those picks. Guests who joined stay."**,
  the destructive **"Remove 18 names"**; toast **"Removed 18 names from the
  list"**. One delete of the party's rows with `joined_at` null
  (`removeExpectedGuests`), so a guest who joins meanwhile stays; each row is
  logged as `guest.removed`.
- Joined guests are not repeated here: they are in Players.
- The card shows only where the database keeps a guest list (the host's
  snapshot has `guests`), so the new app on an older database shows none.

### 7.2 Add guests

[src/components/host/AddGuestsDialog.tsx](../src/components/host/AddGuestsDialog.tsx).
A dialog: **"Add guests"**, **"One name per line. Paste your whole list, or
add a few at a time."**, the field **"Names"** (10 rows, placeholder Ana, Bo,
Mads Holm), and under it, live: **"3 names"**, **"3 names. On more than one
line: Mads. Two people? Add a last name or an initial."**, or **"Over 100
names: add the rest after these"**; then the names exactly as they will be
stored, numbered, in an overlay well (at most 9 rows tall, then it scrolls),
a repeated one marked **"repeated"**. Buttons: **"Cancel"** and the gold
**"Add 3 guests"** ("Add 1 guest"; repeats are not counted; disabled with no
names). Cmd or Ctrl with Enter adds too; Enter starts a new line.

What a pasted line becomes (`namesFromText` and `nameInLine` in
[src/lib/guestList.ts](../src/lib/guestList.ts)): a list mark (`-`, `*`, `•`,
`·`, `1.`, `1)`) goes; a Markdown table row gives its first cell, and the
table's header row (the row right above its `|---|` separator) and the
separator go; a row copied from a rendered table or a sheet (cells split by
tabs) gives its first column; a note in brackets at the end goes ("Ana Holm
(cousin)" is Ana Holm); a Markdown heading (`# Guests`) and a first line that
is only a header word (Name, Names, Navn, Guests, Gæster, Who, Hvem, a colon
after it aside) are not names. So the owner's planning table pasted as it is,
or copied from a viewer, gives one clean name per guest.

On the answer:

- Some added: toast **"Added 12 guests"** (or **"Added Zelda"**), and when
  some were left out: **"Already on the list: Ana and Bo."**, **"Mads was on
  more than one line: added once."** and/or **"Over 40 characters: 1 name."**
  Names read as the list has them (a pasted "bo" reads Bo). A repeat of a
  name that was already on the list is only "already on the list".
- None added, all already there: **"Everyone you added is already on the
  list"**.
- What stays in the field, each kind with its line above the field (bold
  paper): a name this Add listed that was on more than one line, as the list
  has it, with **"Mads was on more than one line, so the list has one Mads. If
  they are two people, add a last name or an initial to the one here and add
  it again. If not, you're done."**; names over 40 characters, with **"This
  name is over 40 characters. Shorten it and add it again."** (or the
  plural); names past the first 100, with **"These are the names after the
  first 100. Add them now."** Otherwise the dialog closes. Editing the field
  clears those lines.
- Refusals under the field: **"Add at most 100 names at a time."**, the
  database's `list_full` words, **"This party is over."**

### 7.3 Rename an expected guest

The rename dialog: **"Rename Zelda"**, **"The name they tap when they join,
and the name in the games' settings."**, at most 40 characters. A taken name
says `Someone is already called "X"`. Logged as `guest.renamed`.

### 7.4 Remove from the list

A confirm: **"Remove Zelda from the guest list?"**, **"Zelda can still join by
typing a name. Game settings that name Zelda lose that pick."**, the
destructive **"Remove"**; toast **"Removed Zelda from the list"**. It deletes
the row only while nobody has taken it; a guest who joined a moment before
stays, with **"That name isn't waiting on the list any more. If they just
joined, they're in Players."** Logged as `guest.removed`.

### 7.5 Free the name (Players and the award page)

Each player's menu gains **"Free the name…"** (`ArrowUUpLeftIcon`) after
"Move to a new phone…", and the award page (where Scan player lands at the
door) gains a section under New phone?: **"Wrong name?"**, **"If this phone
took Ana by mistake, free the name. It goes back on the guest list, and the
phone asks Who are you? again."** and the `secondary` **"Free the name"**,
which opens the same confirm and, once the name is free, goes back to the
control room. Both use
[src/components/host/FreeNameConfirm.tsx](../src/components/host/FreeNameConfirm.tsx).
The confirm:

- **"Free the name Ana?"**
- **"Ana goes back on the guest list as still expected, and the phone that
  has the name asks Who are you? again."**, then when their points are not 0
  **"The 5 points it earned as Ana go with it."**, and while joining is closed
  **"Joining is closed: open it so they can pick their name."**
- The gold **"Free the name"**: not destructive, since the guest can take the
  name again; Remove stays the destructive one. A confirm with a second way
  through (7.5's typed name, 7.6) stacks its buttons, the main one on top,
  since three don't fit side by side.
- Toast **"Ana is free again"**.
- For a name the guest typed (never listed: joined the moment its row was
  made), the first line says **"Mads H goes on the guest list as still
  expected, ..."**, then **"Another spelling of a name on the list? Free it
  and take Mads H off the list."**, and a `secondary` **"Free and take off the
  list"** beside the gold button: it frees the name, then removes it from the
  list (`removeGuest`), so the stray spelling never shows on arriving phones.
  Toast **"Mads H is free and off the list"**.

### 7.6 Remove (Players)

Every joined guest is also their place on the guest list, so Players' Remove
takes them off the list and out of the settings that name them. Its confirm
(`removePlayerDescription`) says so: **"Remove Ana?"**, **"Their points go with
them, and the games running now carry on without them. Ana also leaves the
guest list, and game settings that name Ana lose that pick. Took the wrong
name? Free the name instead: it stays on the list. On a new phone? Move them
instead: their points stay."** The "Took the wrong name?" sentence and a
`secondary` **"Free the name instead"** (which opens 7.5) appear only for a
name that was on the list before this guest took it. On a database without
the guest list the words are the ones from before.

### 7.7 Nothing else changes in the room

The header's count, Players (n), the award page, the move dialog and the recap
count and list joined guests, as before.

---

## 8. Freeing and removing, end to end

**Free (Bo's phone took Ana by mistake):**

1. The host: Free the name on Ana, confirm.
2. The host page: the photo and its folder, best effort; `host_free_guest`;
   the returned `previous_photo`; a sync to each live game.
3. The database, in one transaction: the row and everything it owned deleted,
   the row back as expected with the same id and a new code, the taker's
   targeted toasts gone, `player.freed` logged, the room pinged.
4. Every screen reads again: Ana leaves the TV board, the phones' standings
   and Players, and appears under Still expected.
5. Bo's phone reads `member: false, freed: true` and lands on Who are you?
   with the note. Bo taps Bo, or "I'm not on the list".
6. The syncs run each live game's `onPlayerLeave` for the id at once. When the
   real Ana takes the name later, she is a new join; if no save of a game came
   in between, the re-join detection (4.2) runs leave then join for her at its
   next save.

**When to use which:**

| What happened | What the host does |
| --- | --- |
| Someone tapped the wrong name | Free the name on it (Players' menu, or Scan player and the award page's Wrong name?). Their phone goes back to Who are you?. |
| A guest says their name is taken | The same: Free the name on it. The guest's phone already says to ask the host ("If someone took yours, ask the host to free it."). |
| Someone typed another spelling of a listed name (Ulle for Ulrik) | Free the name on Ulle and choose "Free and take off the list" (the phone goes back to Who are you?, where they tap Ulrik). |
| A paste added rubbish | Remove everyone still expected, then paste again. |
| A guest on the list isn't coming | Remove from the list, or leave the name: a guest who never joins appears nowhere. |
| Someone left the party | Remove, as before. It also takes them off the guest list and out of settings that name them; the confirm says so and offers Free the name for a listed name. |

**Remove an expected guest:** the row is deleted, `guest.removed`, a stage
ping. Settings that named the id now name nobody (fusion's editor shows
"Someone who left").

**Remove a joined guest:** as before; the log row also carries `from_user`.

**Delete the party:** cascades as before; the trigger stays quiet.

---

## 9. What each game must do with expected guests

For the integration to apply to the rebuilt games (fusion/stage,
lydspor/game), and for any new game.

### 9.1 Every game

1. **Only `info.players` play.** They are the guests who joined. The engine
   and the database drop any view, score, points, badge, toast or answer aimed
   at anyone else, so a game never has to filter. It must never require a
   guest named in its settings to be a player.
2. **Settings may name anyone on the guest list.** Store ids from the
   editor's `guests` (`ConfigEditorProps.guests`). At start (`parseConfig`,
   `setup`), accept any id that is in `info.guests`, joined or not. Refuse only
   an id that is in neither list (removed from the list): "Picture 3 names
   someone who isn't on the guest list any more. Pick again in the settings."
   (`parseConfig` sees only the settings; the check against the list belongs
   in `setup`.)
3. **Names come from `info.guests`** (`GameGuest = { id, name, joined }`).
   Phones and the TV only know joined players. Whatever the room must see about
   an expected guest (a reveal, a result), the game copies into its state and
   public state as names, at setup and when the host sets it on the night.
4. **A named guest who arrives mid-round** is an `onPlayerJoin`. From then on
   the game's rules apply to them as to anyone (not scoring on their own
   picture, sitting out).
5. **Answers that name guests:** `options: 'players'` means the guests who
   joined at the moment of answering. `options: 'guests'` (with
   `exclude_self`) means everyone on the list. Put `{ id, name }` of the
   expected guests in the public state so phones can draw them.
6. **An id can change person.** When the host frees a name, the id leaves
   (`onPlayerLeave`). Whoever takes it next joins under the same id
   (`onPlayerJoin`), in the same save if no save came between: the engine
   checks the member's `joined_at` against the game's `saved_at`, and the leave
   hook's effects aimed at the id are dropped. On leave, drop everything the
   game keeps in its state for that id (points, answers, a task, a vote).
   The core's probe game shows why: it keeps its moves, so it scores the old
   person's moves for the new one.
7. **`recap()`**: `round.players` are the guests who joined (and removed
   ones). Names of guests who never came come from the game's state (3).

### 9.2 Participant fusion (fusion/stage)

**Applied on `party/integration` (26 Nov),** on fusion as the stage show with
the two people's own photos. What it does, as built: setup and `setKey`
accept anyone in `info.guests`; `state.names` comes from the list; the vote is
`options: 'guests'` with `exclude_self`; the public state's `expected` holds
`{ id, name }` of every guest on the list who hasn't joined (all of them,
whatever the pictures, so it says nothing about the key), and the phone's
picker lists them after the guests here under "Not here yet"; only locks from
guests here count at a reveal; a picture of a guest who never came is asked
and revealed with their name and their own photo; Show who and the settings
list the whole guest list, an expected guest marked "(not here yet)"; and an
`onPlayerLeave` drops the id's totals and hits. The refusals read "#3 names
someone who isn't on the guest list any more. Pick again in the settings."
and "Pick two people on the guest list". Tests: `fusion/logic.test.ts`
("guests on the list who are not here", and a party where a picture is of a
guest who never came), `view.test.ts`, `fixtures.test.ts`, `PhoneHome.test.ts`
and `fusion.integration.test.ts`. The plan it followed:

- `pictures[].people` may name expected guests. `parseConfig` and `setup`
  check people against `info.guests`, not `ctx.players`.
- `state.names` is filled from `info.guests` for every key person, at setup
  and on `setKey`.
- `setKey` (Show who, on the night) accepts any two ids in `info.guests`; its
  host picker lists `HostViewProps.guests`.
- Votes: `VOTE_SPEC` becomes `{ options: 'guests', exclude_self: true }`, so a
  voter can name Bo who never came. The public state carries `{ id, name }` for
  each expected guest, so `PeoplePicker` and `candidatesFor` list them after
  the joined guests, and the search finds them.
- Scoring: only voters score (they are players). A guest who never came
  neither votes nor scores. "Nobody scores on a picture they are in" applies
  only to a person in the picture who joined.
- Keys naming a guest who never came still work: the picture is asked and
  revealed with that name ("Picture 3 was Ana and Bo" reads the same whether
  Bo came or not), from `state.names`. The reveal's `about` for the log keeps
  only joined ids.
- Recap: `nameOf` already falls back to `state.names`.
- The two refusals move to `info.guests`: `setup`'s "has someone who isn't in
  the party" and `setKey`'s "Pick two people who are in the party".
- Rule 6 (fusion has no `onPlayerLeave` on any branch): add one that drops
  `totals[id]` and the id from every `results[n].hits` (that phone's votes and
  points). `both`, `one`, `none` and `voters` stay as the room saw them. Keep
  the id in `key` and `names`: they name the listed guest in the picture, who
  may take the name back, not the phone that had it. A vote on the open
  picture is a prompt answer, which the free deletes with the row. Test it
  with `simulateParty`: vote and reveal, `freeGuest`, `claimGuest`, sync; the
  scores lack the id and the picture still names the guest.

### 9.3 The photo and song game (lydspor/game)

- **"Doesn't play this game"** (`sitOut`) may name expected guests. One who
  joins later sits out from the moment they join; one who never comes changes
  nothing. `playing` counts `info.players` not sitting out.
- **Who is in a song's photo** (`songs[].inPhoto`) may name expected guests.
  The guard (a guest in a song's photo doesn't score on it) applies once they
  join; one who never comes changes nothing.
- Names shown on a reveal come from `info.guests`, copied into the public
  state.
- The editor's people pickers list `guests`, joined and expected, the
  expected ones marked "not here yet" (as fusion's editor does, 10).
- `finalRows(state, config, info.players)` already scores players only.
- Rule 6 (the game has no `onPlayerLeave` on lydspor/game): add one that drops
  the id from `picks`, from every `review` row's `players` (dropping a row
  left with nobody), and from `shownTop` and `credits`. Before the lock the
  answers are prompt answers, which the free deletes with the row; after it
  they are `picks`, which would otherwise score the old phone's answers for
  whoever takes the name. Keep the id in `sitOut` and `inPhoto`: they name the
  listed guest, not the phone. Test it with `simulateParty`: answer, lock,
  `freeGuest`, `claimGuest`, reveal and crown; the scores lack the id.

### 9.4 Last one standing, the quiz, in-person rounds

- Nothing in their settings names guests, and they deal, ask and score
  `info.players` only, so a listed guest who never comes is invisible to them.
  Nothing to change for expected guests.
- A listed guest who arrives late joins like any late joiner (Last one
  standing: a spectator until the next deal).
- In-person rounds keep nothing per guest in their state (their points are
  host awards, which go with the row on a free), so rule 6 needs nothing there.
- **Rule 6: both the quiz and Last one standing must change before the
  party.** No branch changes `src/games/quiz/logic.ts` or
  `src/games/elimination/logic.ts` (fusion/stage only touches
  `src/games/quiz/clock.ts`), so the integration applies the change below.
  It is a verified patch, with the tests:
  `.design/guest-list/patches/freed-name-leaves-the-round.patch` in the main
  checkout (`git apply` it on the integrated tree; it applied cleanly on
  `guests/list` and every unit test passed with it, 1110 of 1110). Without
  it, Free the name during a running round goes wrong, as the live run of
  26 November and two `simulateParty` runs confirmed:
  - **The quiz** keeps per-player totals (`right`, `quizPoints`, each
    `results[].answers`) and has no `onPlayerLeave`. `scores()` is rebuilt
    from `right` for every id, so after free, take and the next save, the new
    guest has the old person's quiz points: `game_commit` skips the id while
    it is expected and writes the old points again once it is joined.
  - **Last one standing** drops the leaver's task but keeps the id in
    `playerIds`, and its `knockouts` still hold the old person's knockouts
    `by` that id. So the new guest is marked Out on the TV board, in the
    host's Players and the phone standings ("4 of 5 still in"), their card
    says "You're out. Someone got you." after the next save, and `scores()`
    and `knockoutCounts` give them the old person's knockout points. While
    the name is free, `publicState.out` also carries the id to every screen.

  **The quiz's change:** an `onPlayerLeave` that drops the id's totals and
  answers. The counts per option stay as the room saw them.

  ```ts
  onPlayerLeave(state: QuizState, playerId: PlayerId): QuizState {
    const answered = state.results.some((r) => Object.hasOwn(r.answers, playerId))
    if (!Object.hasOwn(state.right, playerId) && !Object.hasOwn(state.quizPoints, playerId) && !answered) return state
    const without = <T>(record: Record<PlayerId, T>): Record<PlayerId, T> =>
      Object.fromEntries(Object.entries(record).filter(([id]) => id !== playerId))
    return {
      ...state,
      right: without(state.right),
      quizPoints: without(state.quizPoints),
      results: state.results.map((r) => (Object.hasOwn(r.answers, playerId) ? { ...r, answers: without(r.answers) } : r)),
    }
  }
  ```

  **Last one standing's change:** the state gains `left?: PlayerId[]`, the
  ids dealt in that then left the party (removed, or the name freed).
  `playerIds` stays as dealt, so `winnerOf` and the crown in `onPlayerLeave`
  keep reading "more than one dealt in" from it, and a round of two where one
  is freed still crowns the other. Two helpers:

  ```ts
  function hasLeft(state: EliminationState, id: PlayerId): boolean {
    return Array.isArray(state.left) && state.left.includes(id)
  }
  /** Dealt in and still the same guest: not someone who left, whose freed name another guest may have taken since. */
  function dealtIn(state: EliminationState, id: PlayerId): boolean {
    return state.playerIds.includes(id) && !hasLeft(state, id)
  }
  /** The knockouts that still score: none by someone who left. */
  function counted(state: EliminationState): Knockout[] {
    return state.knockouts.filter((k) => !hasLeft(state, k.by))
  }
  ```

  - `onPlayerLeave`: return the state unchanged for an id never dealt in;
    otherwise add the id to `left` (once), whether or not it holds a task,
    then drop the task and crown as today.
  - `scores()`, `publicState`'s `knockoutCounts` and `recap()`'s hunter
    counts read `counted(state)`, not `state.knockouts`.
  - `publicState.out` leaves out `hasLeft` ids; `outBy` leaves out knockouts
    whose `target` has left (the TV marks Out from `outBy`).
  - `playerView`: `spectator` when `!dealtIn(state, id)`.
  - `handleAction`'s two refusals ("You're out" against "You joined after
    this game started", and "is already out" against "isn't in this game")
    test `dealtIn`, not `playerIds.includes`.

  Two of today's tests change with it, as intended: leaving when already
  out now returns `{ ...state, left: ['bo'] }`, and a removed player is no
  longer in `out` (no screen showed them there: the views draw only players
  still in the party). The patch adds a `simulateParty` test for each game:
  deal (or answer), `freeGuest`, `claimGuest`, sync; the new guest's scores
  are `{}`, their Last one standing view is `spectator`, `out`, `outBy` and
  `knockoutCounts` lack the id, a re-taken name that was out is not Out, and
  the quiz's `right`, `quizPoints` and `results[].answers` lack the id.

  The Free the name confirm says the points earned under the name go with
  it. That is true at the moment of the free for every game (every score row
  goes with the row), and stays true after the name is taken again only once
  these two changes are in.

### 9.5 Branches that build `GameInfo` or `Loaded` literals

`GameInfo.guests` is required: `testInfo` supplies it, and a hand-built literal
must add it. `Loaded.guests`, `players[].joined_at` and `current.saved_at` are
optional. A screen test that renders a `HostView` or a `ConfigEditor` passes
`guests` too (`guestsOf(snapshot)`).

---

## 10. The settings plumbing and fusion's editor

- `GamesPanel` passes `guests={guestsOf(snapshot)}` to `GameSettings`, which
  hands it to the game's `ConfigEditor` next to `players`.
- `LiveGameCard` passes the same to the game's `HostView`.
- [src/games/fusion/ConfigEditor.tsx](../src/games/fusion/ConfigEditor.tsx),
  the one game file changed here: "Who is in it?" lists `guests` in place of
  `players`, sorted with `sortNames`, an expected guest as **"Zelda (not here
  yet)"** (the mark in paper-3, in the menu and on the chosen value); "Someone
  who left" for a saved id no longer on the list; with nobody on the list,
  **"Add guests to the guest list, or wait for them to join"** (disabled).

---

## 11. Fixtures, tests, smoke

### 11.1 Fixtures

- [src/lib/fixtures.ts](../src/lib/fixtures.ts): every host snapshot carries
  `guests`, the twelve players as joined (`joined_at` their `created_at`) and
  four expected (Zelda, Quentin, Ximena, Ulrik), by name; phone and TV
  snapshots carry `guests: null`. Players have `joined_at`. So every host
  scene, `/host/s/x?fixture=lobby` and the rest, shows the Guest list card with
  four expected.
- `fixtureFreeNames(count)`: the names for the join page's fixture (6.7).
- `npm run dev:setup` adds four names nobody has taken to the demo party.

### 11.2 Unit tests

`guestList.test.ts` (paste, sort, search, counts), `guestListWords` in
`controlRoom.test.ts` (the card's line in its three states, what Add guests
says, the Free the name confirm's parts) with the card rendered from the
fixtures (its search from 9, no Add guests once archived, no card on an older
database), `joinScreen.test.ts`, `WhoAreYou.test.ts`, `runtime.test.ts`
(`info.guests`, re-join), `simulate.test.ts`, `testing.test.ts`,
`live.test.ts`, `PhoneHome.test.ts`, `recap.test.ts`, `fixtures.test.ts`
(guests on the host page only), `queries.test.ts` (each call above) and
`views.test.ts` (every `HostView` and `ConfigEditor` with `guests`, and fusion's
editor with a picture naming an expected guest).

### 11.3 Integration tests

[netlify/lib/guests.integration.test.ts](../netlify/lib/guests.integration.test.ts)
covers every new function and the replaced policy, view and functions: five
phones taking one name at once (one wins), one phone taking two names in two
tabs, `on_list` with a look-alike, what phones, TVs and hosts see, the recap,
`game_load`'s guests and `'players'` against `'guests'` answers, a host award
to a name still expected (refused), a commit that races a free, a full free, renames and removals, Remove from the list's filter,
and a move code used on an expected guest. `realtime.integration.test.ts`
checks that list changes ping the stage only and a free pings the room. Every
older suite passes unchanged: that is the proof a normal join, move, removal
and game behave as before.

### 11.4 Smoke

`npm run smoke` lists two names; a new phone sees both and only names, typing
one gets `on_list`, and it takes that one; the TV lists it and not the other,
which the host's snapshot has as still expected; the host frees it, that phone
reads `freed: true`, and the TV is back to the guests it had.

---

## 12. Applying the migration

- **Locally:** `supabase migration up` from the checkout (never `db reset` on
  a shared stack, never `config push`, never `--linked`).
- **Production** (the owner, before the deploy that needs it, outside the
  party): back up (schema, data and auth users), then `supabase db push
  --linked`. `lock_timeout` is 5 s: on a busy `players` table the file rolls
  back whole and can be pushed again a minute later. The live app keeps working
  on it: same signatures, extra keys ignored, and no expected rows exist until
  the new host room adds some.
- **The new app on a database without it** falls back to the name form on
  phones, shows no Guest list card and no Free the name, and gives games the
  players as the guest list. So the push goes first.

---

## 13. Risks and known limits

1. **Later migrations that replace the same functions** (`session_snapshot`,
   `session_recap`, `game_load`, `game_commit`, `check_answer`, `join_session`,
   `claim_player`, `log_player_change`, the `scoreboard` view) must start from
   this file's version and copy its self-check block, or they bring expected
   guests back onto screens and into games.
2. **A shared local stack's history** now holds 20261126000000. A checkout
   without the file may have `supabase migration up` refuse; copy the file into
   it rather than resetting.
3. **Fusion on `guests/list` alone:** the editor offers expected guests, but
   that branch's fusion refuses to start while a picture names someone who
   has not joined. `party/integration` applies 9.2, so there it starts.
4. **Freeing after games have run** takes the taker's points, answers, photo
   and badges, as the confirm says. Log rows they caused stay under the id, so a
   recap moment from before the free can name the listed guest. Freeing is meant
   for mistakes caught at arrival.
5. **Freed and retaken during a live round** relies on the games' leave hooks
   (9.1, rule 6). Until the integration applies 9.4's patch, a retaken id
   keeps the old person's quiz points if a quiz runs at that moment, and Last
   one standing marks the new person Out and gives them the old person's
   knockout points. The new person never sees the old person's private view:
   freeing deletes it with the row. Until the game's next save they see what a
   late joiner sees; that save runs the join hooks.
6. **Impersonation** is as before: anyone with the join code can take any free
   name, as they could type any name. Closing joining and Free the name are the
   host's tools.
7. **Two guests with the same first name** must be listed apart ("Ana K.",
   "Ana M."): a paste with the same name on two lines adds it once, says so,
   and keeps the second in the field to be told apart (7.2).
8. **A guest who taps "I'm not on the list" with another spelling** joins as
   someone new and leaves the listed name expected; the host fixes it with
   Free and take off the list (7.5). Settings that named the listed id still
   point at it.
9. **A long list in the room:** with many guests still expected, the Guest
   list card makes the right column long on a laptop; the search finds a name.
10. **A name someone took that belongs to another guest** stays taken until
   the host frees it. The real guest's phone says why the name is missing and
   to ask the host; a typed name gets the hint for both fixes (6.4). The
   freed note on the taker's phone says the name went back to the list, also
   after Free and take off the list, where it did not.
