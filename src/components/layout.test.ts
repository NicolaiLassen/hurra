import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorNotice } from '@/components/layout'

const notice = (message: string) => renderToStaticMarkup(createElement(ErrorNotice, { error: new TypeError(message) }))

describe('the error notice', () => {
  it("says the party couldn't be reached when a page's file didn't load, in every browser's words", () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://hurra.example/assets/Recap-x.js',
      'Importing a module script failed.',
      // Safari, for the site's index.html in place of a file a deploy removed.
      "'text/html' is not a valid JavaScript MIME type.",
    ]) {
      expect(notice(message), message).toContain('reach the party. Check your connection, then try again.')
    }
  })

  it('shows any other error in its own words', () => {
    expect(notice('Only hosts can read this')).toContain('Only hosts can read this')
  })
})
