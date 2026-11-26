# User flows

Every screen of the party app and how people get between them: guests on their
phones, the host on a laptop or phone, and the TV. Each diagram marks the gaps
and dead ends found in the UX audit, and whether they are closed or still open.
Section 7 is the flow from "a winner is decided" to "finished", with several
games running at once, and section 8 lists the remaining work with fixes,
files and effort.

Describes the app as of engine v2 ([engine-v2.md](engine-v2.md), sections 5 to
7): several live games at once, the TV as a paired screen, live data on pings,
the recap of the night. Routes are listed in [developing.md](developing.md#pages).

## Legend

- Grey boxes are screens, hexagons are loading or routing decisions.
- **Teal** (`closed`): a gap that is closed, with how.
- **Red** (`open`): a gap or dead end that is still open (see section 6).
- **Gold, dashed** (`proposed`): proposed behavior, not built yet.
- Every page that loads by id or code goes through one shared gate
  (`src/components/QueryGate.tsx`): the loader while it loads, a not-found
  screen with a way back, or "Something went wrong" with Retry. The loader is
  one overlay for the whole app (`src/lib/loader.ts`): at least 1.5 s on first
  open, nothing for quick loads inside the app, at least 600 ms once visible,
  and "This is taking longer than usual" with Retry after 15 s.
- Every live screen (phone, TV, host page, award page) reads the party through
  one `LiveSessionProvider`: a tiny ping when something changes, then one
  snapshot read. Polls back the pings up, so a lost ping only makes a screen a
  little slower, never wrong.

## 1. Entry points

```mermaid
flowchart LR
  classDef entry fill:#29241e,stroke:#f5c542,color:#f2ebde
  classDef route fill:#1e1a16,stroke:#c9bfae,color:#f2ebde

  JQR(["Join QR on the TV or the host's join card"]):::entry --> JOIN["/join/:code<br/>Who are you?, or type a name"]:::route
  LINK(["Copied join link"]):::entry --> JOIN
  TYPED(["Typed code"]):::entry --> HOME["/ start page"]:::route
  HOME -- "Join" --> JOIN
  RET(["Returning guest"]):::entry -- "opens the app" --> HOME
  HOME -- "Continue in the party" --> PLAY["/play/:code<br/>phone home"]:::route
  RET -- "reopens the tab or home screen icon" --> PLAY
  JOIN -- "joined" --> PLAY
  JOIN -- "Got a code from the host?" --> PLAY
  PQR(["A guest's player QR"]):::entry -- "host scanner or camera" --> PCARD["/p/:playerCode<br/>player card"]:::route
  PQR -- "scan sheet inside a game" --> SHEET["Knockout dialog in the game"]:::route
  HOSTE(["Host"]):::entry --> LOGIN["/host/login"]:::route
  LOGIN --> SESS["/host<br/>sessions"]:::route
  SESS --> SP["/host/s/:id<br/>control room"]:::route
  SP -- "Recap" --> RECAP["/host/s/:id/recap<br/>recap of the night"]:::route
  SP -- "Scan player" --> SCAN["/host/scan"]:::route
  SCAN --> PCARD
  TVL(["The TV laptop"]):::entry -- "opens the address from Pair a TV" --> TV["/tv/:code<br/>paired screen"]:::route
  SP -- "Preview the TV, new tab" --> TV
  ANY(["Unknown address"]):::entry --> NF["Page not found<br/>Go to the start page"]:::route
```

## 2. Guest phone

### 2.1 Start page and joining

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde
  classDef open fill:#402118,stroke:#f2603f,color:#f2ebde

  HOME["Start page<br/>type a code, or Continue in the party"]:::screen
  HOME -- "Join with a code" --> J0{{"/join/:code loads"}}:::gate
  HOME -- "Continue in the party" --> P0["/play/:code"]:::screen
  HOME -.- C20["Continue in the party's name, checked first;<br/>a party that's gone is forgotten (C20)"]:::closed
  J0 -- "lots of guests signing in at once" --> BUSY["Lots of guests arriving, one moment<br/>the sign-in retries for up to 30 s"]:::closed
  BUSY --> J0
  J0 -- "network or server error" --> E1["Something went wrong<br/>Retry"]:::closed
  J0 -- "unknown or malformed code" --> NF1["Party not found<br/>Join another party<br/>forgets the stored code"]:::closed
  J0 -- "already a player here" --> P0
  J0 -- "party archived" --> AR1["This party is over<br/>Join another party"]:::closed
  J0 -- "joining closed" --> CL1["Joining is closed<br/>lets you in as soon as the host reopens"]:::closed
  CL1 -. "host opens joining" .-> LIST
  J0 -- "joining open" --> LIST{{"Free names on the guest list?"}}:::gate
  LIST -- "none, an error, or a party without a list" --> FORM["What should we call you?"]:::screen
  LIST -- "the host listed names" --> WHO["Who are you?<br/>the free names, a search from 9,<br/>I'm not on the list"]:::closed
  WHO -- "tap a name" --> CONF["You're Ana?<br/>Yes, I'm Ana or No, go back"]:::screen
  CONF -- "No, go back" --> WHO
  CONF -- "someone just took it, or it left the list:<br/>back with a note" --> WHO
  CONF -- "Yes, I'm Ana" --> P0
  WHO -- "I'm not on the list" --> FORM
  FORM -- "Back to the list" --> WHO
  FORM -- "a typed name that is on the list" --> OFFER["Ana is on the guest list.<br/>Yes, I'm Ana"]:::closed
  OFFER -- "Yes, I'm Ana" --> P0
  OFFER -- "edit the name" --> FORM
  WHO -- "Got a code from the host?" --> CODE
  WHO -.- C26["C26 closed: the host adds the guests before the party;<br/>settings can name them before they join"]:::closed
  FORM -- "name taken, or closed meanwhile" --> FERR["Inline error under the name"]:::screen
  FERR --> FORM
  FERR -- "Is that you? Ask the host:<br/>they free the name, or give a code" --> CODE["Got a code from the host?<br/>6-character code field"]:::screen
  FORM -- "Got a code from the host?" --> CODE
  CODE -- "wrong or expired code" --> CERR["The code is wrong or has expired.<br/>Ask the host for a new one."]:::screen
  CERR --> CODE
  CODE -- "the host's code" --> P0
  CODE -.- C21["G4 closed: the host's Move to a new phone gives a code;<br/>the player, points and badges move to this phone (C21)"]:::closed
  FORM -- "Let's go" --> P0
```

### 2.2 Phone home

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  P0{{"/play/:code loads"}}:::gate
  P0 -- "unknown or malformed code" --> NF["Party not found<br/>Join another party"]:::closed
  P0 -- "error" --> ER["Something went wrong<br/>Retry"]:::closed
  P0 -- "not a player here" --> JOIN["/join/:code"]:::screen
  P0 -- "player" --> PH["Phone home<br/>avatar, name, badges, sound, points"]:::screen
  PH --> S{"The main card"}:::gate
  S -- "no game live, none finished lately" --> LOBBY["Lobby: You're in.<br/>faces of the latest joiners"]:::screen
  S -- "a game on the TV" --> LIVE["On the TV: the game's own screen"]:::screen
  S -- "a game live off the TV, no result to show" --> LIVE2["Now playing: the newest live game"]:::screen
  S -- "the last game finished, none started since<br/>(background games stay compact cards)" --> RES["Finished: the game's result for me<br/>Waiting for the next game"]:::closed
  S -- "party archived" --> WRAP["That's a wrap.<br/>Your night once the recap is published"]:::closed
  PH --> ALSO["Also running: a compact card per other live game<br/>Open shows the whole game in a sheet"]:::screen
  PH --> LATE["Finished lately: a row per other finished game<br/>tap shows its result in a sheet"]:::screen
  PH --> NIGHT["Your night: rank, points by game, moments<br/>once the recap is published"]:::screen
  PH --> STAND["Standings, Show my code bar"]:::screen
  S -- "party deleted while open" --> NF
  S -- "host removed me" --> REM["You're no longer in X<br/>Join again"]:::closed
  S -- "host moved my player to another phone" --> MOVED["Your player moved to another phone"]:::closed
  S -- "host freed my name" --> FREED["Who are you?, with: The host gave the name Ana<br/>back to the list. Pick your own name."]:::closed
  REM --> JOIN
  FREED --> JOIN
  LOBBY -- "host starts a game" --> LIVE
  LIVE -- "the game finishes, by itself or by End" --> RES
  RES -- "the next game starts" --> LIVE
  RES -.- C22["G1 closed: a result card per finished game,<br/>the game's own ResultView or a generic one (C22)"]:::closed
```

Announcements from games show as toasts on every phone. Ones aimed at one player
replace the room-wide one and play one sound (the strongest of the batch). A
refused answer or move is a toast with the server's own words, from the game's
view.

### 2.3 Last one standing on the phone

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  START(["Host starts the game, usually in the background"]) --> V{"My view"}:::gate
  V -- "still loading" --> DEAL["Dealing tasks..."]:::screen
  V -- "dealt in" --> ALIVE["Survivor meter, secret task card,<br/>Got someone? Scan their code, players list"]:::screen
  V -- "joined after the start" --> SPEC["Spectator: you'll be dealt in next time<br/>survivor meter and players list"]:::screen
  V -- "another game holds the main card" --> CARD["Compact card: You're in, 17 of 45 standing<br/>the task behind a tap, Got someone? Scan"]:::screen
  CARD -- "Open" --> ALIVE
  ALIVE -- "tap the card" --> REVEAL["Task shown, hides after 8 s"]:::screen
  REVEAL --> ALIVE
  ALIVE -- "Got someone? Scan their code" --> SHEET["Scan sheet: Scan or My code"]:::screen
  SHEET -- "Close" --> ALIVE
  SHEET -- "camera unavailable" --> TYPE["Type their code instead"]:::screen
  TYPE --> SHEET
  SHEET -- "own code, or not from this party" --> TERR["Error toast"]:::screen
  TERR --> ALIVE
  SHEET -- "a player's code" --> DIALOG["You scanned X<br/>They did my task, or I caught them trying theirs"]:::screen
  DIALOG -- "Neither, cancel" --> ALIVE
  DIALOG -- "rule broken: already out, game over" --> TERR
  DIALOG -- "tag" --> TAG["X is out, their task is mine<br/>toast and coin"]:::screen
  DIALOG -- "catch" --> CATCH["X is out, I keep my task<br/>toast and coin"]:::screen
  TAG --> ALIVE
  CATCH --> ALIVE
  ALIVE -- "someone gets me" --> OUT["You're out: who and with which task<br/>N still standing, sad sound"]:::screen
  ALIVE -- "I'm the last one left" --> WIN["You're the last one standing.<br/>fanfare"]:::screen
  WIN -- "the game finishes by itself" --> RESULT["Result card: You're the last one standing."]:::closed
  OUT -- "a winner is decided" --> RESULT2["Result card: You're out, Mads got you. Ana won."]:::closed
  SPEC --> RESULT3["Result card: Ana won"]:::closed
  RESULT -.- C23["G6 closed: the deciding knockout finishes the game,<br/>with no End needed (C23)"]:::closed
```

### 2.4 Player QR codes (/p/:playerCode)

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  SC(["A player QR is scanned or opened"]) --> PC{{"/p/:playerCode"}}:::gate
  PC -- "error" --> PCE["Something went wrong<br/>Retry"]:::closed
  PC -- "host, code exists" --> AWARD["Award points (section 3.3)"]:::screen
  PC -- "host, unknown code" --> UNK["Unknown player<br/>Scan again, Back to your sessions"]:::closed
  PC -- "guest, my own code" --> MINE["This is your QR code<br/>Back to the game"]:::closed
  PC -- "guest of the same party, someone else's code" --> INTO["Into my game with the code (C17)<br/>a game that takes codes opens its own dialog<br/>others: a toast with whose code it is"]:::closed
  PC -- "guest of another party, or an unknown code" --> UNKG["Unknown code: this code isn't from your party, or it is wrong<br/>Back to the game, or Go to the start page"]:::closed
  PC -- "not signed in on this browser" --> NSI["Player code (C16)<br/>Only the host can give points with this code<br/>Host login, Go to the start page"]:::closed
```

### 2.5 Lydspor on the phone

The flow as built from `.design/lydspor/spec.md`, section 4.

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  START(["The host starts Lydspor on the TV"]) --> LOB["Lobby: the intro, four rules,<br/>Event +2, Title +1, Singer +1"]:::screen
  LOB -- "the host taps Play song n" --> NOW["Now playing: Name song n.<br/>1 Title and 2 Who sings it, typed<br/>3 Event: tap its photo on the wall, A to L"]:::screen
  NOW -- "Next and Done save each field;<br/>a photo saves at once" --> NAMED["Song n is named.<br/>Open your board"]:::screen
  NOW -- "a photo another song has" --> SWAP["Song 2 and song 5 swapped events.<br/>Undo for 8 s"]:::screen
  SWAP --> NOW
  NAMED -- "Your board" --> BOARD["Your board: a row per song played,<br/>as typed; any cell opens to change it"]:::screen
  BOARD -- "a new song starts while I type or read" --> BANNER["Song 6 is playing. Name it"]:::screen
  BANNER --> NOW
  BOARD -- "the host taps Last call" --> LAST["Last call: 60 s countdown,<br/>each missing part as a one-tap row"]:::screen
  NOW -- "the host taps Last call" --> LAST
  LAST -- "time is up, or the host locks now" --> LOCKED["Your answers are locked.<br/>the board read-only"]:::closed
  LOCKED -- "the host reveals song n" --> REV["The storyteller tells the story. Look at the TV.<br/>Song 1: 3 of 4 points; per part what I typed<br/>and whether it counted (Spelling forgiven.)"]:::screen
  REV -- "the host accepts my close answer" --> REV
  REV -- "the next reveal" --> REV
  REV -- "after the last reveal" --> TOP["The top 5 is on the TV.<br/>My points with my own average:<br/>Your own photo counts as 3 of them."]:::screen
  TOP -- "the host crowns Lydspor" --> RES
  REV -- "the host crowns Lydspor" --> RES["Result card: You won Lydspor, +20 on the night board,<br/>or my place and payout"]:::closed
  START -- "I sit this one out" --> SIT["You sit this one out. Enjoy the show."]:::closed
```

Typed answers are saved when a field is left (Next, Done, another field, a
photo, the page going hidden, or the last call changing the screen under it),
never per letter. Spelling is forgiven on the
server at the lock, never judged on the phone, and nobody's typed answer ever
reaches another phone or the TV.

## 3. Host

The host pages are the same on a laptop and a phone. On a phone the header
buttons wrap under the title, each game's buttons get a row of their own under
its title, and the join card moves to the bottom. The host pages load on
demand, so guests' phones never download them.

### 3.1 Login, sessions and the control room

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  ANYH(["Any /host page"]) --> RQ{{"Signed in as a host?"}}:::gate
  RQ -- "error" --> RQE["Something went wrong<br/>Retry"]:::closed
  RQ -- "no" --> LOGIN["Host login"]:::screen
  LOGIN -- "wrong password, or not a host" --> LOGIN
  LOGIN -- "signed in" --> SESS
  LOGIN -.- C19["Returns to the page that asked for the login (C19)"]:::closed
  RQ -- "yes" --> SESS["Sessions<br/>new session form, list, Archived toggle"]:::screen
  SESS -- "Create" --> SP
  SESS -- "join code taken" --> T1["Error under the join code field"]:::closed
  SESS -- "row menu" --> SM["Rename, Archive with Undo, Unarchive,<br/>Delete after typing the name"]:::screen
  SESS -- "open a row" --> SP{{"/host/s/:id loads"}}:::gate
  SP -- "random or malformed id, deleted" --> SNF["Session not found<br/>Back to your sessions"]:::closed
  SP -- "error" --> SPE["Something went wrong<br/>Retry"]:::closed
  SP -- "found" --> PAGE["Control room header<br/>join code, live dot, name, Close or Open joining,<br/>Pair a TV, Recap, menu"]:::screen
  PAGE -- "menu: Rename" --> PAGE
  PAGE -- "menu: Delete, type the name" --> SESS
  PAGE -- "menu: Archive" --> PAGEA["Archived note, joining closed, Undo toast"]:::screen
  PAGE --> STAGE["On the TV now (3.4)"]:::screen
  PAGE --> LIVEG["Live now: a card per live game (3.2)"]:::screen
  PAGE --> GP["Games: the program (3.2)"]:::screen
  PAGE --> PL["Players (3.2)"]:::screen
  PAGE --> GLC["Guest list (3.2)"]:::screen
  PAGE --> JC["Join card: QR, code, Copy join link"]:::screen
```

The live dot is teal while the page hears changes as they happen, and grey
("Catching up") while it reads every few seconds instead. A game's timer that
keeps failing to get through shows a warning above the live games: "Quiz's
timer isn't getting through. Use its buttons to move on by hand." The host
page sends each timer's sync 1.5 s after the TV would, as a backup.

### 3.2 Live games, the program and the players

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  ADD["Add game: type and title"]:::screen --> PEND["Row: not started<br/>Start split button, menu"]:::screen
  PEND -- "menu: Settings" --> SET["The game's own settings editor<br/>Save or Cancel; a problem that would stop<br/>the start shows when you save"]:::screen
  SET --> PEND
  PEND -- "Start on the TV, or Start in the background,<br/>disabled while it sends" --> LIVE["Live card: title, Live, On the TV or In the background,<br/>Show on the TV, End, the game's own controls"]:::closed
  PEND -- "can't start: no questions, under 2 players" --> ERR["Error toast in the game's words"]:::screen
  ERR --> PEND
  LIVE -- "a winner is decided" --> FIN
  LIVE -- "End, after a confirm" --> FIN["Row: finished, Mads won,<br/>On the TV or Show on the TV, menu"]:::closed
  FIN -- "menu: Restart, after a confirm" --> LIVE
  FIN -- "menu: Archive" --> ARCH["Archived list<br/>Undo toast, Unarchive"]:::screen
  ARCH -- "menu: Unarchive" --> FIN
  FIN -- "menu: Delete, type the name" --> GONE["Game deleted<br/>it leaves every screen"]:::closed
  PEND -- "menu: Delete, type the name" --> GONE
  ARCH -- "menu: Delete, type the name" --> GONE
  PLR["Player row: rank, avatar, name, badges, points"]:::screen -- "name, or menu: Give points" --> AW["/p/:code Award points"]:::screen
  PLR -- "menu: Rename" --> PLR
  PLR -- "menu: Move to a new phone" --> MOVE["A 6-character code with its time left,<br/>the join link as a QR"]:::closed
  PLR -- "menu: Remove, after a confirm" --> REMV["Player removed, their points with them<br/>off the guest list too; live games carry on without them"]:::closed
  REMV -. "a listed name: Free the name instead" .-> FREE
  PLR -- "menu: Free the name, after a confirm" --> FREE["Back on the guest list as still expected,<br/>the phone asks Who are you? again, its points go"]:::closed
  AW -- "Wrong name? Free the name" --> FREE
  FREE -- "a typed name: Free and take off the list" --> GLR
  GL["Guest list: 12 of 30 here. 18 still expected.<br/>Still expected, with a search from 9"]:::screen -- "Add guests" --> ADDG["One name per line, pasted or typed, a table too<br/>the names as they will be stored, then Added 12 guests"]:::closed
  ADDG -- "a name over 40 characters, or on two lines, stays in the field" --> ADDG
  GL -- "Remove everyone still expected, after a confirm" --> GLR
  GL -- "menu: Rename" --> GL
  GL -- "menu: Remove from the list, after a confirm" --> GLR["The name leaves the list<br/>settings that named it lose that pick"]:::closed
  FREE --> GL
```

The Guest list card sits under Players (on a phone, before the join card).
Before the party the host adds every guest's name; a guest who joins taps
theirs under Who are you?, and game settings, such as fusion's "Who is in
it?" and Lydspor's "Who's in this photo" and "Doesn't play this game", can
name guests who haven't joined yet, marked "(not here yet)". The
card lists only the guests still expected: joined guests are in Players. Free
the name is for a guest who tapped the wrong name, from Players' menu or the
award page; for another spelling (Ulle for Ulrik), Free and take off the list
on Ulle. Remove also takes a guest off the list, and its confirm offers Free
the name for a listed name. Remove everyone still expected undoes a paste that
went wrong. A name on the list that never joins appears nowhere else but in
Participant fusion, where a picture may be of them: phones can name them in a
guess (under "Not here yet") and the reveal shows their name. The words of each screen are in
[guest-list.md](guest-list.md), section 7.

Each live game has its own card, so its controls sit with its title and its End
(P2-4). The game's own controls are its `HostView`: the quiz's one big button
for the next step and its answered count; fusion's one gold step (Start the
showing, Ask the next picture, Reveal now, Back to the wall, Crown the face
detective), its locked-in count, an Ask on every picture and who is in each
picture; Last one standing's who is still in; Lydspor's Play song n, Last
call, Reveal song n with the close answers to accept (one tap counts an
answer for everyone who typed it, Undo takes it back) and Crown Lydspor.
Secrets (the quiz's
answers, fusion's people, the tasks) stay behind a Show toggle, because the
host's phone is out in the room. A game whose controls crash shows a note in
its card; Show on the TV and End keep working.

The split button starts a game the way it presents itself: the quiz,
Participant fusion, Lydspor and in-person rounds take the TV, Last one
standing runs in the background. The caret offers the other way.

Participant fusion on the stage, from the host's side:

```mermaid
flowchart LR
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde

  START["Start: the title card,<br/>then the lobby"]:::screen -- "Start the showing" --> SHOW["The showing<br/>each picture, 6 s"]:::screen
  START -- "menu: Skip the showing" --> WALL
  SHOW -- "by itself, or Skip to the wall" --> WALL["The wall<br/>every picture at once"]:::screen
  WALL -- "Ask #5, or Ask on any picture" --> ASK["A picture asked<br/>30 s, phones lock in"]:::screen
  ASK -- "by itself when time's up,<br/>or Reveal now" --> REV["The reveal<br/>the two people's own photos<br/>beside it, 10 s"]:::screen
  REV -- "by itself, or Back to the wall" --> WALL
  REV -- "menu: Skip the wall: ask #6" --> ASK
  WALL -- "after the last: Crown the face detective;<br/>before it: the menu, after a confirm" --> DONE["The winner's screen"]:::screen
```

A picture without its two people can't be asked: set them with Show who
first. In the settings each person can have their own photo; it stays
secret until the reveal, where the TV shows it beside the picture, and the
host picks each person beside their photo (with Show who too). Without one,
the reveal shows the guest's profile photo, or their token. The settings and
Show who pick from the whole guest list, so a picture may be of a guest who
hasn't come, marked "(not here yet)"; it is asked and revealed like any other,
with that guest's name, and phones list the guests still expected after the
guests here when they pick. A round started before the update (when fusion ran in the background)
can't go on: End it, then restart it, and its pictures and people are kept.

### 3.3 Scanning and points

```mermaid
flowchart LR
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde

  NAV["Header: Scan player"]:::screen --> SCAN["/host/scan<br/>camera, or type the code"]:::screen
  SCAN -- "not a player QR" --> SCAN
  SCAN -- "player QR or code" --> AWARD["Award points<br/>For game, Reason, +1 to +10, other amount"]:::screen
  AWARD -- "+N" --> DONE["Toast: +N to X<br/>History row with Undo"]:::screen
  DONE -- "Undo" --> AWARD
  AWARD -- "Scan next" --> SCAN
  AWARD -- "Move to a new phone" --> MOVE["The move code dialog (3.2)"]:::screen
  AWARD -- "back arrow" --> SP["Control room"]:::screen
```

"For game" picks the game the host came from (`?game=<id>`, which Scan player
and Scan next carry along), else the game on the TV if it is live, else the
newest live game. The award page runs its own live session, so it works from
any player QR.

### 3.4 The TV from the host page

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  STAGE["On the TV now: the scene in words and as a small TV"]:::screen
  STAGE -- "a game is live on the TV" --> SLIVE["Quiz, live on the TV<br/>Back to standings keeps it running"]:::screen
  STAGE -- "a finished game's final screen" --> SFIN["Final result: Quiz<br/>The TV goes back in 2:59<br/>gold Back to standings"]:::closed
  STAGE -- "nothing on the stage" --> SSTAND["The standings<br/>Last game: Mads won Quiz"]:::screen
  STAGE -- "the recap plays" --> SREC["The recap of the night<br/>Back to the party"]:::screen
  STAGE -- "a recap is published" --> SHOWR["Show the recap on the TV"]:::screen
  STAGE --> SCR["1 TV paired, Unpair after a confirm<br/>or No TV paired yet"]:::screen
  SCR -- "Pair a TV" --> PAIR["The TV's address and a 6-character code<br/>with its time left; Preview the TV"]:::screen
  PAIR -- "the TV laptop types the code" --> PAIRED["Closes by itself: The TV is paired"]:::closed
  SFIN -- "Back to standings, or 3 minutes" --> SSTAND
```

The TV is a paired screen, never a host: it reads exactly what a guest reads,
so nothing in the room can open the control room or read a secret. Show on the
TV on a finished game shows its final screen again for 3 minutes.

### 3.5 The recap of the night

```mermaid
flowchart LR
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef closed fill:#203733,stroke:#4fd1c5,color:#f2ebde

  SP["Control room"]:::screen -- "Recap" --> BUILD["/host/s/:id/recap<br/>built from the night's event log in this browser"]:::screen
  BUILD --> PREV["Preview: the headline and podium, the awards,<br/>the race, a chapter per game, the TV's slides,<br/>any guest's Your night on a phone, the timeline"]:::screen
  PREV -- "Publish, or Update" --> PUB["Every phone shows Your night<br/>the room's screens follow each Update"]:::closed
  PUB -- "Show on the TV" --> TVR["The TV plays the recap on a loop"]:::screen
  TVR -- "Back to the party" --> PUB
  PUB -- "Unpublish, after a confirm" --> PREV
  PREV -- "Rebuild" --> BUILD
  PREV -- "Download the night" --> FILE["The raw night as JSON, hosts only"]:::screen
```

The recap can be built any time, also mid-party: a game still running gets a
chapter with only who leads, so publishing early never gives away a live task
or an answer. When more has happened since the last Publish, the page says so.
The page holds the loader until the night is in, then shows it whole; pressing
Recap in a control room opened before a deploy loads the new app straight onto
the recap.

## 4. The TV

The TV laptop opens `/tv/:code`, a public page. It signs in anonymously and asks
to be paired; the host's own browser skips that with a small Host preview label.

```mermaid
flowchart TD
  classDef screen fill:#1e1a16,stroke:#c9bfae,color:#f2ebde
  classDef gate fill:#14110e,stroke:#f5c542,color:#f2ebde
  classDef closed fill:#29241e,stroke:#a59c8c,color:#f2ebde

  OPEN(["/tv/:code opened on the TV laptop"]) --> TVL{{"The party loads"}}:::gate
  TVL -- "unknown code" --> PNF["Party not found"]:::closed
  TVL -- "error" --> TVE["Something went wrong<br/>Retry"]:::closed
  TVL -- "not paired" --> PAIR["Pair this screen: a 6-character code field<br/>On the host page, tap Pair a TV and type the code shown there"]:::screen
  PAIR -- "wrong or expired code" --> PAIR
  PAIR -- "the host's code" --> MODE
  TVL -- "paired, or the host's browser" --> MODE{"What to show"}:::gate
  MODE -- "party archived" --> FINAL["Final standings<br/>no way in"]:::closed
  MODE -- "the recap is shown" --> RECAP["The recap: numbers, the race,<br/>a slide per chapter, lead changes, the night's podium"]:::screen
  MODE -- "a game live on the stage" --> TAKE["Hurra presents: a 3 s title card,<br/>then the game's TV screen in the frame"]:::screen
  MODE -- "a finished game on the stage" --> FIN["Its final screen for 3 minutes: its own,<br/>or the winner's colour with Hurra for Bo!"]:::closed
  MODE -- "nothing on the stage" --> POD["The standings: the leader as a hero, the next five,<br/>the field, the join block while joining is open"]:::screen
  TAKE -- "the game finishes" --> FIN
  FIN -- "Back to standings, or 3 minutes" --> POD
  TAKE --> BAND["The band: one line per game in the background,<br/>Join with HURRA30 at its right"]:::screen
  MODE -- "host unpairs it" --> PAIR
  POD -. "announcement" .-> NEWS["The news strap across the top row for 8 s, one sound"]:::closed
```

Every TV screen but the recap and the pairing screen stands in one on-air
frame ([identity.md, The TV's frame](identity.md#the-tvs-frame)) inside the 5
percent safe area: the programme strap at the top left (a tilted tab with
what is on, the hunt's in pink, and a paper strap with where it is, "Question
3 of 10"), the bug at the top right (the party's name, the time of night and
the logo), the stage at full width, and the band along the bottom with one
line per game running in the background, at most two (newer ones share "Also
running"), with "Join with HURRA30" at its right while a game holds the
stage.

Big news is a strap across the whole top row for 8 seconds, over the
programme strap and the bug, so it never covers the stage or the band; a
game's own news on its final screen only plays its sound. While a game holds
the stage, news from a game in the background is the band's event line, with
its time and no sound, except a winner, which gets the strap and its sound.
Nothing crawls, there is no red, and the TV says a game's news without its
exclamation marks. Phones show the same news as a toast (the shared callout,
`src/components/Callout.tsx`): a square icon chip by its job, the title and
an optional detail line.

The corner, under the band outside the safe area, holds the full screen
button, the sound toggle ("Click for sound" while the browser blocks audio)
and the connection as a word, Live or Reconnecting. The standings fit any
party: the leader's column (the hero, the next five places and a line on how
the last game moved the places) beside the field of rows, measured in fit.ts,
with the join block under the field (the QR code on paper, the code and the
page's own address) or its short form, the code over the address, when the
rows need the room.

Lydspor on the TV is silent from Play song 1 to the crown: while a song plays
it shows the wall of photos A to L and how many have typed a title, a singer
and a photo (never what); at each reveal the photo, the title, the singer and
the room's counts, which follow the host's accepts in place. A typed answer
never shows on the TV.

## 5. Errors, not found and the ways back

| Case | Phone | Host page | TV |
| --- | --- | --- | --- |
| Unknown or malformed code or id | Party not found, Join another party (forgets the stored code) | Session not found, Back to your sessions | Party not found |
| Party deleted while open | Party not found, Join another party | Session not found (or back to the list after deleting it there) | Party not found |
| Party archived | That's a wrap., with Your night once published; the join link says This party is over | Archived note | Final standings, or the recap if shown |
| Joining closed | Joining is closed, opens by itself when the host reopens | Joining is closed card, faded QR | No join card |
| Player removed | You're no longer in X, Join again | Row gone | Row gone |
| Player moved to another phone | Your player moved to another phone | Row stays, with its points | Row stays |
| Name freed by the host | Who are you?, with "The host gave the name Ana back to the list. Pick your own name." | Row gone from Players, back under Still expected | Row gone |
| Name taken a moment before (Yes, I'm Ana) | Back to Who are you?, with "Someone just took Ana. If that's you, ask the host to free your name." | Not applicable | Not applicable |
| Game deleted (End it first if it is live) | It leaves the lists, its result card too | Row gone | Back to the standings if it was on the stage |
| A game's timer can't get through | Not applicable | A warning above the live games | Keeps trying, with backoff |
| Unknown player code | Unknown code, Back to the game | Unknown player, Scan again, Back to your sessions | Not applicable |
| Pairing code wrong or expired | Not applicable | Get a new code in Pair a TV | The code field says so |
| TV unpaired by the host | Not applicable | No TV paired yet | Back to its pairing screen by itself |
| First load fails | Something went wrong, Retry (friendly text when offline) | Same | Same |
| A reload fails while data is shown | Data stays; retries after 1 s, 2 s, 5 s, then every 10 s, and on coming back online | Same | Same |
| Pings stop arriving | Reads every 5 s until they come back | Live dot grey (Catching up), reads every 5 s | Live dot grey, reads every 5 s |
| Nothing answers for 15 s | This is taking longer than usual, Retry | Same | Same |
| Session refresh fails after sleep | Error with Retry; never a new anonymous player | Error with Retry | Error with Retry |
| Unknown address | Page not found, Go to the start page | Same | Same |

## 6. Gaps and dead ends

### Closed

| ID | Was | Now |
| --- | --- | --- |
| C1 | A wrong or malformed party code was a dead end | Party not found with Join another party |
| C2 | Joining is closed was a dead end and never updated | Updates live when the host reopens; Join another party |
| C3 | Continue in session X looped into a deleted party | The stored code is forgotten on Party not found |
| C4 | Archived party: phones said the next game starts soon; newcomers were told to ask the host to open it | That's a wrap., This party is over, and Final standings on the TV |
| C5 | A removed player kept a working phone home | You're no longer in X, Join again |
| C6 | A deleted game vanished silently | Toast on the phone, back to the lobby |
| C7 | Random, malformed or deleted ids showed the loader forever (host, TV) | Session not found with a way back |
| C8 | Errors had no way out | Something went wrong with Retry, friendly offline text |
| C9 | A failed reload replaced good data with an error | Data stays, retries with backoff and on coming back online |
| C10 | A stuck load spun forever | 15 s safety net with Retry |
| C11 | A failed session refresh signed the phone in as a new anonymous player (player and points lost) | Treated as an error with Retry |
| C12 | A double tap on Start dealt the game twice | Start, End and Restart are disabled while they send, and every call carries one request id, so a resent tap counts once |
| C13 | Host's unknown player code had only a text link | Scan again and Back to your sessions |
| C14 | My own QR code page had only a text link | Back to the game button |
| C15 | Two sounds at once (TV coin over the knockout sound, winner's phone) | One sound at a time with priorities |
| C16 | A browser that isn't signed in saw "Unknown code" for a real player code | "Player code" with Host login and Go to the start page |
| C17 | A camera scan of another player's QR during Last one standing was a dead end | A player of the same party goes into their game with the code; games that take codes (declared with `acceptsScans`) open their own dialog, others show whose code it is |
| C18 | Last one standing's TV tiles ran off the screen with 24 or more players, under the sound pill | Tiles pick the largest of four sizes that fits (checked with 8, 24 and 45 players at 1920x1080 and 1440x900); a gutter keeps the corner controls clear |
| C19 | Host login always landed on /host, not the TV or award link that asked for it | The login returns to the page that asked (same site only) |
| C20 | The start page offered Continue with a bare code, even for a party that was gone | It looks the party up first: "Continue in Nicolai's 30th", and forgets a party that's gone |
| C21 | G4: a guest on a new phone or browser couldn't get their player back | The host's Move to a new phone (player menu or award page) shows a 6-character code for 5 minutes (closing the dialog cancels it); on the new phone, Got a code from the host moves the player there with their points and badges, and the old phone says so |
| C22 | G1: no result on the phones or the TV once a game finished | A result card on every phone until the next game starts (the game's own `ResultView` or a generic one), a final screen on the TV for 3 minutes, and Finished lately rows for the others |
| C23 | G6: a decided game stayed Live until the host pressed End | A game finishes itself (`isFinished`) in the same save as the deciding move; End is still there for ending early |
| C24 | G9: with two in-person rounds live, a round's Scan a player opened the award page with the stage game or the newest live game picked | The round's Scan a player sends its own game id (`?game=<id>`), which the scanner carries to the award page |
| C25 | An old phone that slept through its player's move woke to "You're no longer in X" | The snapshot says the player moved, so it shows "Your player moved to another phone" with Join with a new name |
| C26 | Fusion's pictures could only name guests who had joined, so the host couldn't set the game up before the party | The guest list ([guest-list.md](guest-list.md)): the host adds every name before the party, a guest taps theirs under Who are you?, and settings can name guests still expected |

### Open, in priority order

None. What is left is in section 8.

## 7. Winner decided, then finished

Built in engine v2. The core only knows a game's lifecycle (not started, live,
finished) and who finished it: the game itself or the host. A finished game
comes with a final screen for the TV and a result for each phone, both drawn by
the game. The core decides when they show, never what is in them. Several games
can be live at once: one on the TV stage, the others in the background.

### 7.1 Game lifecycle

```mermaid
stateDiagram-v2
  [*] --> NotStarted: host adds the game
  NotStarted --> Live: host presses Start, on the TV or in the background
  Live --> Finished: the game declares itself finished
  Live --> Finished: host presses End
  Finished --> Live: host presses Restart
  Finished --> Archived: host archives it
  Archived --> Finished: host unarchives it
  NotStarted --> [*]: host deletes it
  Finished --> [*]: host deletes it
  Archived --> [*]: host deletes it
```

### 7.2 What the TV shows

```mermaid
stateDiagram-v2
  [*] --> Standings
  Standings --> GameScreen: a game starts on the TV, or the host shows a live one there
  GameScreen --> Standings: host presses Back to standings (the game keeps running)
  GameScreen --> FinalScreen: the game finishes
  Standings --> FinalScreen: a game finishes while the stage is free
  FinalScreen --> Standings: host presses Back to standings
  FinalScreen --> Standings: 3 minutes pass
  FinalScreen --> GameScreen: host starts a game on the TV
  Standings --> Recap: host shows the published recap
  Recap --> Standings: host presses Back to the party
  Standings --> PartyOver: host archives the party
  GameScreen --> PartyOver: host archives the party
  FinalScreen --> PartyOver: host archives the party
```

A game that finishes takes the stage when it is free (nothing on it, or a
finished game whose 3 minutes are over) or already its own. When another game
is live on the stage, the TV's rail shows a Finished chip instead, and the host
can put it on the TV.

### 7.3 The winning move

```mermaid
sequenceDiagram
  participant W as Winner's phone
  participant E as Game engine
  participant DB as Database
  participant TV
  participant H as Host page
  participant O as Other phones
  W->>E: last knockout
  E->>E: the game applies it and says it is finished
  E->>DB: state, announcements, status finished, finished_at, winners, the stage
  DB-->>TV: ping, then one snapshot read
  TV->>TV: winner banner with one fanfare, then the final screen
  DB-->>H: ping, then one snapshot read
  H->>H: the card moves to the program as Finished with Mads won, and Back to standings counts down
  DB-->>W: ping, then one snapshot read
  W->>W: toast and fanfare, then my result card
  DB-->>O: ping, then one snapshot read
  O->>O: toasts, then their result cards
  H->>DB: Back to standings (clears the spotlight)
  DB-->>TV: podium and standings
```

### 7.4 Each screen, from the winning move to the next game

| Moment | Host page | TV | Phones that played | Others |
| --- | --- | --- | --- | --- |
| The winning move | The card shows the winner | The game's screen shows the winner and one fanfare; a game in the background gets the news strap | Winner: toast and fanfare. Last one out: out state, sad sound | Toast |
| Finished, a moment later | The card moves to Games as Finished, with Mads won and On the TV (or Show on the TV). On the TV now says Final result with a gold Back to standings and "The TV goes back in 2:59" | If it held the stage or the stage was free: the final screen. If another game holds the stage: the news strap, and a Finished chip beside the standings later | The main card turns into the result card; games live in the background stay compact cards. If another game is live on the TV: a Finished lately row | The generic result card or row |
| Back to standings, or 3 minutes | The countdown goes away | The standings with "Last game: Mads won X" | No change: the result stays until the next game | No change |
| The host starts a game on the TV | That game is live and on the TV | The title card, then its screen | Its card becomes main. Whatever the guest had open in the game that had the main card (such as a knockout being confirmed) stays on top until they finish | Same |
| The host restarts the finished game | Live again, a new round | Its screen if it takes the TV | Dealt in again | Dealt in |
| The host archives the party | Archived note | Final standings, or the recap if shown | That's a wrap., Your night when published | Same |

Why 3 minutes: long enough for the room to cheer, read the top hunters and take
photos, short enough that a forgotten final screen never hides the standings for
the rest of the night. The host's next action always wins straight away. The 3
minutes count from when the game finished or was put on the TV, whichever is
later, so Show on the TV on a finished game shows its final screen again.

Ending early works the same way: when the host presses End, the game is finished
by the host. The final screen shows how it stood (for example "3 still
standing") together with the game's End announcement.

### 7.5 How the core does it

- **Finishing.** After every change the engine asks the game whether it is
  finished (`isFinished`). If it is, the same save runs `onEnd(..., 'game')`
  and sets status `finished`, `finished_at`, `finished_by = 'game'` and the
  winners (by default the top of this round's points, nobody when the top is
  0). End sets `finished_by = 'host'`.
- **The stage.** `sessions.spotlight_game_id` and `spotlight_at` (set by the
  database whenever the spotlight changes). Starting a game on the TV takes the
  stage; finishing takes it when it is free; Back to standings clears it;
  archiving or deleting the spotlit game clears it. Clients compute the 3
  minutes from `max(finished_at, spotlight_at)` by the database clock, so every
  screen agrees without a server timer.
- **Game screens.** A game may bring a `FinalTvView` for the TV (else its
  `TvView` with `finished`, else a generic winners screen) and a `ResultView`
  for phones (else "Mads won X" and my points).
- **Edge cases.** A TV opened later shows the final screen only inside the 3
  minutes. Several TVs agree, since they read the same data. Restart starts a
  new round and its points start over; points the host gave by hand stay.

## 8. Remaining work

Effort: XS under 30 minutes, S 1 to 2 hours, M half a day, L a day or more.
Every item is frontend only unless it says otherwise.

### P1

| # | Problem | Proposed fix | Files | Effort |
| --- | --- | --- | --- | --- |
| P1-1 (done) | G3: a browser that isn't signed in (a fresh phone, or a host whose login expired) sees "Unknown code" for a real player code, with no way to log in. Introduced in the checkpoint batch | With no user, show "X's player code" or "Player code", "Only the host can give points with this code", with Host login (returning here after login, see P2-1) and Go to the start page | `src/pages/PlayerCard.tsx` | XS |
| P1-2 (done) | G5: Last one standing's TV tiles have two fixed sizes and no fit logic. 24 players at 1440x900 run off the bottom, and the sound pill covers the last row. 45 players on a 1080p TV don't fit either | Measure the space left and pick the largest tile size that fits; players still in first; a bottom gutter for the corner controls. Checked with 8, 24 and 45 players at 1920x1080 and 1440x900 | `src/games/elimination/TvView.tsx`, `src/pages/host/Scoreboard.tsx`, `src/lib/useElementSize.ts` | M |
| P1-3 (done) | G1 and G6: a decided game stays Live until End; after End the phones drop to the lobby with no result and the TV jumps straight to the standings | Engine v2: `isFinished`, `finished_at` and `finished_by`, the spotlight with its 3 minutes, `ResultView` and `FinalTvView`, the result card on phones, the final screen on the TV, and On the TV now with Back to standings and its countdown on the host page (section 7) | engine v2 | M |
| P1-4 (done) | G2: during Last one standing, a camera scan of another player's QR lands on "Only the host can give points with this code", but the guest wanted to knock that player out | For a signed-in player of the same party, `/p/:code` sends them to `/play/:joinCode?scanned=CODE`; a game that accepts scans opens its own dialog | `src/pages/PlayerCard.tsx`, `src/pages/Play.tsx`, `src/games/types.ts`, `src/games/elimination/PlayerView.tsx` | S |

### P2

| # | Problem | Proposed fix | Files | Effort |
| --- | --- | --- | --- | --- |
| P2-1 (done) | G7: login always lands on /host, so a TV opening its scoreboard link, or a host scanning a code after the login expired, has to find the page again | Remember where the login was asked for and go back there afterwards | `src/pages/host/RequireHost.tsx`, `src/pages/host/HostLogin.tsx` | XS |
| P2-2 (done) | G4: a guest on a new phone or browser finds their name taken and can't get their player back; the host can only remove them, which loses the points | Move to a new phone on the host page and the award page: a one-time code the guest types on the join page under Got a code from the host. `host_issue_transfer` and `claim_player` in the database | `src/components/host/MovePlayerDialog.tsx`, `src/pages/Join.tsx`, the v2 init file | M |
| P2-3 (done) | Status badges show database words in lower case: pending, active, finished, open, closed, archived; the award page says "(live)" | A shared StatusBadge: Not started, Live, Finished, Open, Closed, Archived | `src/components/StatusBadge.tsx` | S |
| P2-4 (done) | The live game's panel sits above the list, apart from its own row and End button | Each live game has its own card: title, where it shows, Show on the TV, End and its controls together | `src/components/host/LiveGameCard.tsx` | S |
| P2-5 (done) | Restart is gold like Start although it resets the game's points, and its confirm text was wrong for in-person rounds | Restart moved into the finished game's menu, with a confirm: "It starts again and its points start over. Points you gave by hand stay." | `src/components/host/GamesPanel.tsx` | XS |
| P2-6 (done) | Tap targets under 40 px on phones | Dialog actions default to lg; row icon buttons at least 32 px; host navigation lg | `src/components/ui/alert-dialog.tsx`, the host pages | S |
| P2-7 (partly done) | Repeated UI: each game drew its own "Now playing" header; small uppercase labels exist in three styles in several places; the phone's QR overlay re-implements PlayerQr | Done: games draw their content only, and the phone and TV draw the card and its header (engine v2, section 6). Left: a shared Eyebrow label, and the overlay using PlayerQr | new `src/components/Eyebrow.tsx`, `src/components/PlayerQr.tsx` | S |
| P2-8 (done) | Host forms: a taken join code shows a toast instead of an error under the field; the "RANDOM" placeholder looks like a typed value; the add-game title field repeats the select's text and has no label | Inline error on the field; placeholder styling as in the scanner's code field; placeholder "Title (optional)" | `src/pages/host/HostHome.tsx`, `src/components/host/GamesPanel.tsx` | XS |
| P2-9 (done) | G8: the start page says "Continue in session G52513" and only finds out the party is gone after the tap; guest copy mixes "session" and "party" | Look the party up on the start page: "Continue in Nicolai's 30th", forget it if it's gone; say "party" to guests | `src/pages/Home.tsx` | S |
| P2-10 (done) | The host scanner is a black box until the camera starts, and its heading is smaller than on other host pages | "Starting camera" state over the video; same heading size as the other host pages | `src/components/QrScanner.tsx`, `src/pages/host/Scan.tsx` | XS |
| P2-11 (done) | G9: with two in-person rounds live, the award page can't tell which one the host scanned from | The award page and Scan player take `?game=<id>`; the round's Scan a player link sends its own game id | `src/games/in-person/HostView.tsx` | XS |
| P2-12 | On the TV at 1440x900 with 45 guests, Last one standing's final screen beside the rail squeezes its tiles into small chips without avatars, because its own Top hunters column keeps its 24rem | Move that column under the tiles when the game's area is narrower than about 1100 px, or slim the rail on final screens | `src/games/elimination/TvView.tsx` | S |
| P2-13 | Phones download every game's host controls and settings editors with the app: the main chunk is 980 kB (277 kB gzipped) | Load each game's `HostView` and `ConfigEditor` lazily, as the TV views already are, with a Suspense fallback in the host's game card and settings | the four `src/games/*/index.ts`, `src/components/host/LiveGameCard.tsx`, `src/components/host/GameSettings.tsx` | S |

### Smaller polish (P3, done)

- The two confirm dialogs share one layout, and Confirm also opens from a menu.
- Default tasks use curly inner quotes: “Get someone to say ‘ribbit’ like a frog”.
- The host login page has the logo and a "Join the party" link back to the start page.
- Party, game and player names can be changed from their menus.
