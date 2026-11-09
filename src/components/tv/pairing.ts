/** Pairing codes are 6 characters (host_issue_screen_code). */
export const CODE_LENGTH = 6

/** What a typed or pasted code becomes: capitals and digits only, at most 6. */
export function cleanCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH)
}

/** claim_screen pairs this browser with whichever party the code is for; a code for another party is refused here. */
export const OTHER_PARTY = "That code pairs a TV for another party. Get a new code from this party's host page."
