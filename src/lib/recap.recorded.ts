// A raw recap (session_recap(), docs/engine-v2.md 2.7) recorded on the local stack:
// a party of six played through the real engine. Last one standing still runs
// (its tasks are in the round's state), Beer pong finished by the host and runs
// again as round 2, a lab quiz with one prompt finished by itself, one award was
// undone and Cy was removed. For recap.test.ts only.
import type { RawRecap } from './recap'

export const recordedRawRecap: RawRecap = {
  "log": [
    {
      "at": 1794188212237,
      "id": 861,
      "data": {
        "name": "Recorded party",
        "join_code": "TJSQ8CA6"
      },
      "kind": "session.created",
      "about": [],
      "actor": "host",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": null
    },
    {
      "at": 1794188212253,
      "id": 862,
      "data": {
        "name": "Ana",
        "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      },
      "kind": "player.joined",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "at": 1794188212269,
      "id": 863,
      "data": {
        "name": "Bo",
        "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
      },
      "kind": "player.joined",
      "about": [
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    },
    {
      "at": 1794188212285,
      "id": 864,
      "data": {
        "name": "Cy",
        "player_id": "b9787143-0e75-4127-aae6-001fcacad5e3"
      },
      "kind": "player.joined",
      "about": [
        "b9787143-0e75-4127-aae6-001fcacad5e3"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "b9787143-0e75-4127-aae6-001fcacad5e3"
    },
    {
      "at": 1794188212300,
      "id": 865,
      "data": {
        "name": "Dee",
        "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4"
      },
      "kind": "player.joined",
      "about": [
        "a30b0904-8466-4b3e-a573-928cf548b8f4"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4"
    },
    {
      "at": 1794188212316,
      "id": 866,
      "data": {
        "name": "Eve",
        "player_id": "26883963-3e23-4fa7-829e-609f2ec0c690"
      },
      "kind": "player.joined",
      "about": [
        "26883963-3e23-4fa7-829e-609f2ec0c690"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "26883963-3e23-4fa7-829e-609f2ec0c690"
    },
    {
      "at": 1794188212333,
      "id": 867,
      "data": {
        "name": "Finn",
        "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      },
      "kind": "player.joined",
      "about": [
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "player",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
    },
    {
      "at": 1794188212348,
      "id": 868,
      "data": {
        "title": "Last one standing",
        "game_type": "elimination"
      },
      "kind": "game.added",
      "about": [],
      "actor": "host",
      "round": null,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212359,
      "id": 869,
      "data": {
        "title": "Beer pong",
        "game_type": "in-person"
      },
      "kind": "game.added",
      "about": [],
      "actor": "host",
      "round": null,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212367,
      "id": 870,
      "data": {
        "title": "Lab quiz",
        "game_type": "lab"
      },
      "kind": "game.added",
      "about": [],
      "actor": "host",
      "round": null,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212381,
      "id": 871,
      "data": {
        "stage": "keep"
      },
      "kind": "game.start",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212381,
      "id": 872,
      "data": {
        "announcements": [
          {
            "id": 146,
            "icon": "megaphone",
            "sound": "gong",
            "detail": "6 players, one life each",
            "message": "Last one standing has started"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212381,
      "id": 873,
      "data": {},
      "kind": "game.started",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212396,
      "id": 874,
      "data": {
        "action": {
          "type": "tag",
          "target": "b9787143-0e75-4127-aae6-001fcacad5e3"
        }
      },
      "kind": "game.action",
      "about": [
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    },
    {
      "at": 1794188212396,
      "id": 875,
      "data": {
        "scores": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": 1
        },
        "profiles": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": {
            "tags": 1
          }
        },
        "announcements": [
          {
            "id": 147,
            "icon": "sword",
            "tone": "pink",
            "sound": "slash",
            "detail": "“Get someone to say ‘cheers’ in another language”",
            "message": "Bo got Cy"
          },
          {
            "id": 148,
            "to": [
              "09de38e0-dab1-4887-84a8-3a1b5b415942"
            ],
            "icon": "sword",
            "tone": "pink",
            "sound": "coin",
            "detail": "Their task is yours now.",
            "message": "Cy is out!"
          },
          {
            "id": 149,
            "to": [
              "b9787143-0e75-4127-aae6-001fcacad5e3"
            ],
            "icon": "skull",
            "tone": "red",
            "sound": "sad",
            "detail": "Bo got you",
            "message": "You're out!"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212430,
      "id": 876,
      "data": {
        "action": {
          "type": "catch",
          "target": "a30b0904-8466-4b3e-a573-928cf548b8f4"
        }
      },
      "kind": "game.action",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "at": 1794188212430,
      "id": 877,
      "data": {
        "scores": {
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": 1
        },
        "profiles": {
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": {
            "catches": 1
          }
        },
        "announcements": [
          {
            "id": 150,
            "icon": "detective",
            "tone": "teal",
            "sound": "gotcha",
            "detail": "Trying “Get someone to say your name three times”",
            "message": "Ana caught Dee"
          },
          {
            "id": 151,
            "to": [
              "45c601d7-41c2-4f96-abf8-3f522b3c085f"
            ],
            "icon": "detective",
            "tone": "teal",
            "sound": "coin",
            "detail": "You keep your task.",
            "message": "You caught Dee!"
          },
          {
            "id": 152,
            "to": [
              "a30b0904-8466-4b3e-a573-928cf548b8f4"
            ],
            "icon": "skull",
            "tone": "red",
            "sound": "sad",
            "detail": "Ana caught you trying your task",
            "message": "You're out!"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212465,
      "id": 878,
      "data": {
        "action": {
          "type": "tag",
          "target": "26883963-3e23-4fa7-829e-609f2ec0c690"
        }
      },
      "kind": "game.action",
      "about": [
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    },
    {
      "at": 1794188212465,
      "id": 879,
      "data": {
        "scores": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": 1
        },
        "profiles": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": {
            "tags": 2
          }
        },
        "announcements": [
          {
            "id": 153,
            "icon": "sword",
            "tone": "pink",
            "sound": "slash",
            "detail": "“Get someone to do an impression of someone famous”",
            "message": "Bo got Eve"
          },
          {
            "id": 154,
            "to": [
              "09de38e0-dab1-4887-84a8-3a1b5b415942"
            ],
            "icon": "sword",
            "tone": "pink",
            "sound": "coin",
            "detail": "Their task is yours now.",
            "message": "Eve is out!"
          },
          {
            "id": 155,
            "to": [
              "26883963-3e23-4fa7-829e-609f2ec0c690"
            ],
            "icon": "skull",
            "tone": "red",
            "sound": "sad",
            "detail": "Bo got you",
            "message": "You're out!"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212501,
      "id": 880,
      "data": {
        "action": {
          "type": "tag",
          "target": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
        }
      },
      "kind": "game.action",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "at": 1794188212501,
      "id": 881,
      "data": {
        "scores": {
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": 1
        },
        "profiles": {
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": {
            "tags": 1
          }
        },
        "announcements": [
          {
            "id": 156,
            "icon": "sword",
            "tone": "pink",
            "sound": "slash",
            "detail": "“Get someone to show you the last photo on their phone”",
            "message": "Ana got Finn"
          },
          {
            "id": 157,
            "to": [
              "45c601d7-41c2-4f96-abf8-3f522b3c085f"
            ],
            "icon": "sword",
            "tone": "pink",
            "sound": "coin",
            "detail": "Their task is yours now.",
            "message": "Finn is out!"
          },
          {
            "id": 158,
            "to": [
              "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
            ],
            "icon": "skull",
            "tone": "red",
            "sound": "sad",
            "detail": "Ana got you",
            "message": "You're out!"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212534,
      "id": 882,
      "data": {
        "action": {
          "type": "tag",
          "target": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
        }
      },
      "kind": "game.action",
      "about": [
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    },
    {
      "at": 1794188212534,
      "id": 883,
      "data": {
        "scores": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": 1
        },
        "profiles": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": {
            "tags": 3,
            "wins": 1
          }
        },
        "announcements": [
          {
            "id": 159,
            "icon": "sword",
            "tone": "pink",
            "sound": "slash",
            "detail": "“Get someone to give you a high five”",
            "message": "Bo got Ana"
          },
          {
            "id": 160,
            "to": [
              "09de38e0-dab1-4887-84a8-3a1b5b415942"
            ],
            "icon": "sword",
            "tone": "pink",
            "sound": "coin",
            "detail": "Their task is yours now.",
            "message": "Ana is out!"
          },
          {
            "id": 161,
            "to": [
              "45c601d7-41c2-4f96-abf8-3f522b3c085f"
            ],
            "icon": "skull",
            "tone": "red",
            "sound": "sad",
            "detail": "Bo got you",
            "message": "You're out!"
          },
          {
            "id": 162,
            "icon": "crown",
            "sound": "fanfare",
            "detail": "3 knockouts",
            "message": "Bo is the last one standing!"
          },
          {
            "id": 163,
            "to": [
              "09de38e0-dab1-4887-84a8-3a1b5b415942"
            ],
            "icon": "crown",
            "sound": "fanfare",
            "detail": "3 knockouts",
            "message": "You're the last one standing!"
          }
        ]
      },
      "kind": "game.effects",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "game_type": "elimination",
      "player_id": null
    },
    {
      "at": 1794188212567,
      "id": 884,
      "data": {
        "stage": "take"
      },
      "kind": "game.start",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212567,
      "id": 885,
      "data": {},
      "kind": "game.started",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212567,
      "id": 886,
      "data": {
        "title": "Beer pong",
        "reason": "start",
        "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268"
      },
      "kind": "stage.changed",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212575,
      "id": 887,
      "data": {
        "points": 3,
        "reason": "Sank two cups",
        "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
        "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "score_event_id": 19
      },
      "kind": "points.awarded",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "host",
      "round": null,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "at": 1794188212588,
      "id": 888,
      "data": {
        "points": 2,
        "reason": "Trick shot",
        "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
        "player_id": "26883963-3e23-4fa7-829e-609f2ec0c690",
        "score_event_id": 20
      },
      "kind": "points.awarded",
      "about": [
        "26883963-3e23-4fa7-829e-609f2ec0c690"
      ],
      "actor": "host",
      "round": null,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": "26883963-3e23-4fa7-829e-609f2ec0c690"
    },
    {
      "at": 1794188212610,
      "id": 889,
      "data": {},
      "kind": "game.end",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212610,
      "id": 890,
      "data": {},
      "kind": "game.finished",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "host",
      "round": 1,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212621,
      "id": 891,
      "data": {
        "stage": "take"
      },
      "kind": "game.start",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212621,
      "id": 892,
      "data": {},
      "kind": "game.started",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212621,
      "id": 893,
      "data": {
        "title": "Lab quiz",
        "reason": "start",
        "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea"
      },
      "kind": "stage.changed",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212630,
      "id": 894,
      "data": {
        "close": [],
        "action": {
          "key": "q1",
          "spec": {
            "kind": "choice",
            "options": [
              "a",
              "b"
            ]
          },
          "type": "open"
        }
      },
      "kind": "game.host_action",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212630,
      "id": 895,
      "data": {
        "prompts": {
          "opened": [
            "q1"
          ]
        }
      },
      "kind": "game.effects",
      "about": [],
      "actor": "game",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212634,
      "id": 896,
      "data": {
        "ms": 4,
        "key": "q1",
        "round": 1,
        "answer": {
          "choice": [
            "a"
          ]
        }
      },
      "kind": "prompt.answered",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "at": 1794188212639,
      "id": 897,
      "data": {
        "ms": 9,
        "key": "q1",
        "round": 1,
        "answer": {
          "choice": [
            "b"
          ]
        }
      },
      "kind": "prompt.answered",
      "about": [
        "a30b0904-8466-4b3e-a573-928cf548b8f4"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4"
    },
    {
      "at": 1794188212643,
      "id": 898,
      "data": {
        "ms": 13,
        "key": "q1",
        "round": 1,
        "answer": {
          "choice": [
            "a"
          ]
        }
      },
      "kind": "prompt.answered",
      "about": [
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "player",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
    },
    {
      "at": 1794188212651,
      "id": 899,
      "data": {
        "close": [
          "q1"
        ],
        "action": {
          "key": "q1",
          "type": "reveal"
        }
      },
      "kind": "game.host_action",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212651,
      "id": 900,
      "data": {
        "scores": {
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": 1,
          "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7": 1,
          "a30b0904-8466-4b3e-a573-928cf548b8f4": 1
        },
        "prompts": {
          "revealed": [
            "q1"
          ]
        }
      },
      "kind": "game.effects",
      "about": [
        "b9787143-0e75-4127-aae6-001fcacad5e3",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212661,
      "id": 901,
      "data": {
        "close": [],
        "action": {
          "type": "finish"
        }
      },
      "kind": "game.host_action",
      "about": [],
      "actor": "host",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212661,
      "id": 902,
      "data": {},
      "kind": "game.finished",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "a30b0904-8466-4b3e-a573-928cf548b8f4"
      ],
      "actor": "game",
      "round": 1,
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "game_type": "lab",
      "player_id": null
    },
    {
      "at": 1794188212667,
      "id": 903,
      "data": {
        "points": 1,
        "reason": "Best costume",
        "game_id": null,
        "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "score_event_id": 21
      },
      "kind": "points.awarded",
      "about": [
        "a30b0904-8466-4b3e-a573-928cf548b8f4"
      ],
      "actor": "host",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4"
    },
    {
      "at": 1794188212670,
      "id": 904,
      "data": {
        "points": 5,
        "reason": "Oops",
        "game_id": null,
        "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "score_event_id": 22
      },
      "kind": "points.awarded",
      "about": [
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "host",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
    },
    {
      "at": 1794188212674,
      "id": 905,
      "data": {
        "points": 5,
        "reason": "Oops",
        "game_id": null,
        "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "score_event_id": 22
      },
      "kind": "points.undone",
      "about": [
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "host",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
    },
    {
      "at": 1794188212677,
      "id": 906,
      "data": {
        "name": "Cy",
        "player_id": "b9787143-0e75-4127-aae6-001fcacad5e3"
      },
      "kind": "player.removed",
      "about": [
        "b9787143-0e75-4127-aae6-001fcacad5e3"
      ],
      "actor": "host",
      "round": null,
      "game_id": null,
      "game_type": null,
      "player_id": "b9787143-0e75-4127-aae6-001fcacad5e3"
    },
    {
      "at": 1794188212686,
      "id": 907,
      "data": {
        "stage": "keep"
      },
      "kind": "game.start",
      "about": [],
      "actor": "host",
      "round": 2,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212686,
      "id": 908,
      "data": {},
      "kind": "game.started",
      "about": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "a30b0904-8466-4b3e-a573-928cf548b8f4",
        "26883963-3e23-4fa7-829e-609f2ec0c690",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
      ],
      "actor": "game",
      "round": 2,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": null
    },
    {
      "at": 1794188212692,
      "id": 909,
      "data": {
        "points": 4,
        "reason": "Round two",
        "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
        "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "score_event_id": 23
      },
      "kind": "points.awarded",
      "about": [
        "09de38e0-dab1-4887-84a8-3a1b5b415942"
      ],
      "actor": "host",
      "round": null,
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "game_type": "in-person",
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    }
  ],
  "games": [
    {
      "id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "title": "Last one standing",
      "status": "active",
      "position": 0,
      "game_type": "elimination"
    },
    {
      "id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "title": "Beer pong",
      "status": "active",
      "position": 0,
      "game_type": "in-person"
    },
    {
      "id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "title": "Lab quiz",
      "status": "finished",
      "position": 0,
      "game_type": "lab"
    }
  ],
  "rounds": [
    {
      "round": 1,
      "state": {
        "tasks": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": "Get someone to tell you a joke"
        },
        "knockouts": [
          {
            "at": 1794188212391,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to say ‘cheers’ in another language",
            "method": "tag",
            "target": "b9787143-0e75-4127-aae6-001fcacad5e3"
          },
          {
            "at": 1794188212427,
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "task": "Get someone to say your name three times",
            "method": "catch",
            "target": "a30b0904-8466-4b3e-a573-928cf548b8f4"
          },
          {
            "at": 1794188212462,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to do an impression of someone famous",
            "method": "tag",
            "target": "26883963-3e23-4fa7-829e-609f2ec0c690"
          },
          {
            "at": 1794188212497,
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "task": "Get someone to show you the last photo on their phone",
            "method": "tag",
            "target": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
          },
          {
            "at": 1794188212532,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to give you a high five",
            "method": "tag",
            "target": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
          }
        ],
        "playerIds": [
          "45c601d7-41c2-4f96-abf8-3f522b3c085f",
          "09de38e0-dab1-4887-84a8-3a1b5b415942",
          "b9787143-0e75-4127-aae6-001fcacad5e3",
          "a30b0904-8466-4b3e-a573-928cf548b8f4",
          "26883963-3e23-4fa7-829e-609f2ec0c690",
          "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
        ]
      },
      "config": {
        "tasks": [
          "Get someone to sing a line from a song",
          "Get someone to say ‘ribbit’ like a frog",
          "Get someone to give you a high five",
          "Get someone to tell you their middle name",
          "Get someone to do a little dance",
          "Get someone to take a selfie with you",
          "Get someone to say the word ‘banana’",
          "Get someone to sit down on the floor",
          "Get someone to hum a tune",
          "Get someone to compliment your outfit",
          "Get someone to touch their nose",
          "Get someone to clink glasses with you",
          "Get someone to tell you a joke",
          "Get someone to show you the last photo on their phone",
          "Get someone to talk in an accent",
          "Get someone to say your name three times",
          "Get someone to say ‘cheers’ in another language",
          "Get someone to do an impression of someone famous",
          "Get someone to tell you their star sign",
          "Get someone to hold your drink for you",
          "Get someone to say ‘bless you’",
          "Get someone to give you a hug",
          "Get someone to pull a funny face",
          "Get someone to whistle",
          "Get someone to tell you their favourite film",
          "Get someone to count to five in another language",
          "Get someone to check the time for you",
          "Get someone to snap their fingers",
          "Get someone to fix your collar or hair",
          "Get someone to say ‘you’re right’"
        ],
        "pointsPerTag": 1,
        "pointsPerCatch": 1
      },
      "points": {
        "09de38e0-dab1-4887-84a8-3a1b5b415942": 3,
        "45c601d7-41c2-4f96-abf8-3f522b3c085f": 2
      },
      "scores": {
        "09de38e0-dab1-4887-84a8-3a1b5b415942": 3,
        "45c601d7-41c2-4f96-abf8-3f522b3c085f": 2
      },
      "game_id": "9302ff54-01c2-48fc-97f1-8a84f3436d3a",
      "winners": [],
      "started_at": 1794188212381,
      "finished_at": null,
      "finished_by": null,
      "public_state": {
        "out": [
          "45c601d7-41c2-4f96-abf8-3f522b3c085f",
          "b9787143-0e75-4127-aae6-001fcacad5e3",
          "a30b0904-8466-4b3e-a573-928cf548b8f4",
          "26883963-3e23-4fa7-829e-609f2ec0c690",
          "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
        ],
        "feed": [
          {
            "at": 1794188212532,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to give you a high five",
            "method": "tag",
            "target": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
          },
          {
            "at": 1794188212497,
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "task": "Get someone to show you the last photo on their phone",
            "method": "tag",
            "target": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
          },
          {
            "at": 1794188212462,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to do an impression of someone famous",
            "method": "tag",
            "target": "26883963-3e23-4fa7-829e-609f2ec0c690"
          },
          {
            "at": 1794188212427,
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "task": "Get someone to say your name three times",
            "method": "catch",
            "target": "a30b0904-8466-4b3e-a573-928cf548b8f4"
          },
          {
            "at": 1794188212391,
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "task": "Get someone to say ‘cheers’ in another language",
            "method": "tag",
            "target": "b9787143-0e75-4127-aae6-001fcacad5e3"
          }
        ],
        "alive": [
          "09de38e0-dab1-4887-84a8-3a1b5b415942"
        ],
        "outBy": {
          "26883963-3e23-4fa7-829e-609f2ec0c690": {
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "method": "tag"
          },
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": {
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "method": "tag"
          },
          "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7": {
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "method": "tag"
          },
          "a30b0904-8466-4b3e-a573-928cf548b8f4": {
            "by": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
            "method": "catch"
          },
          "b9787143-0e75-4127-aae6-001fcacad5e3": {
            "by": "09de38e0-dab1-4887-84a8-3a1b5b415942",
            "method": "tag"
          }
        },
        "winner": "09de38e0-dab1-4887-84a8-3a1b5b415942",
        "knockoutCounts": {
          "09de38e0-dab1-4887-84a8-3a1b5b415942": 3,
          "45c601d7-41c2-4f96-abf8-3f522b3c085f": 2
        }
      }
    },
    {
      "round": 1,
      "state": {},
      "config": {},
      "points": {
        "26883963-3e23-4fa7-829e-609f2ec0c690": 2,
        "45c601d7-41c2-4f96-abf8-3f522b3c085f": 3
      },
      "scores": {},
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "winners": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f"
      ],
      "started_at": 1794188212567,
      "finished_at": 1794188212610,
      "finished_by": "host",
      "public_state": {}
    },
    {
      "round": 1,
      "state": {
        "done": true,
        "moves": 0,
        "opened": [
          "q1"
        ],
        "secret": null,
        "revealed": [
          {
            "key": "q1",
            "count": 3,
            "answers": {
              "45c601d7-41c2-4f96-abf8-3f522b3c085f": {
                "choice": [
                  "a"
                ]
              },
              "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7": {
                "choice": [
                  "a"
                ]
              },
              "a30b0904-8466-4b3e-a573-928cf548b8f4": {
                "choice": [
                  "b"
                ]
              }
            }
          }
        ]
      },
      "config": {
        "secret": null
      },
      "points": {
        "45c601d7-41c2-4f96-abf8-3f522b3c085f": 1,
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7": 1,
        "a30b0904-8466-4b3e-a573-928cf548b8f4": 1
      },
      "scores": {
        "45c601d7-41c2-4f96-abf8-3f522b3c085f": 1,
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7": 1,
        "a30b0904-8466-4b3e-a573-928cf548b8f4": 1
      },
      "game_id": "414a5ee9-6e3b-4a30-8b86-d4891eaed8ea",
      "winners": [
        "45c601d7-41c2-4f96-abf8-3f522b3c085f",
        "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
        "a30b0904-8466-4b3e-a573-928cf548b8f4"
      ],
      "started_at": 1794188212621,
      "finished_at": 1794188212661,
      "finished_by": "game",
      "public_state": {
        "moves": 0,
        "opened": [
          "q1"
        ],
        "revealed": [
          {
            "key": "q1",
            "count": 3
          }
        ]
      }
    },
    {
      "round": 2,
      "state": {},
      "config": {},
      "points": {
        "09de38e0-dab1-4887-84a8-3a1b5b415942": 4
      },
      "scores": {},
      "game_id": "9e90bcf4-20c8-4ec7-9c2b-c5de10642268",
      "winners": [],
      "started_at": 1794188212686,
      "finished_at": null,
      "finished_by": null,
      "public_state": {}
    }
  ],
  "players": [
    {
      "id": "45c601d7-41c2-4f96-abf8-3f522b3c085f",
      "name": "Ana",
      "profile": {
        "elimination": {
          "tags": 1,
          "catches": 1
        }
      },
      "joined_at": 1794188212250,
      "removed_at": null
    },
    {
      "id": "09de38e0-dab1-4887-84a8-3a1b5b415942",
      "name": "Bo",
      "profile": {
        "elimination": {
          "tags": 3,
          "wins": 1
        }
      },
      "joined_at": 1794188212266,
      "removed_at": null
    },
    {
      "id": "b9787143-0e75-4127-aae6-001fcacad5e3",
      "name": "Cy",
      "profile": {},
      "joined_at": 1794188212285,
      "removed_at": 1794188212677
    },
    {
      "id": "a30b0904-8466-4b3e-a573-928cf548b8f4",
      "name": "Dee",
      "profile": {},
      "joined_at": 1794188212297,
      "removed_at": null
    },
    {
      "id": "26883963-3e23-4fa7-829e-609f2ec0c690",
      "name": "Eve",
      "profile": {},
      "joined_at": 1794188212313,
      "removed_at": null
    },
    {
      "id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7",
      "name": "Finn",
      "profile": {},
      "joined_at": 1794188212330,
      "removed_at": null
    }
  ],
  "session": {
    "id": "8ed0b743-8687-46e5-b327-dbe84b469715",
    "name": "Recorded party",
    "created_at": 1794188212235,
    "archived_at": null
  },
  "standings": [
    {
      "name": "Bo",
      "points": 7,
      "player_id": "09de38e0-dab1-4887-84a8-3a1b5b415942"
    },
    {
      "name": "Ana",
      "points": 6,
      "player_id": "45c601d7-41c2-4f96-abf8-3f522b3c085f"
    },
    {
      "name": "Dee",
      "points": 2,
      "player_id": "a30b0904-8466-4b3e-a573-928cf548b8f4"
    },
    {
      "name": "Eve",
      "points": 2,
      "player_id": "26883963-3e23-4fa7-829e-609f2ec0c690"
    },
    {
      "name": "Finn",
      "points": 1,
      "player_id": "a0fde980-4fc6-41ae-b6f6-f20fed3a8ab7"
    }
  ]
}
