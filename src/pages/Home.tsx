import { ArrowRightIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { currentUser } from '@/lib/auth'
import { useLoaderHold } from '@/lib/loader'
import { getSessionByCode } from '@/lib/queries'
import { forgetJoinCode, lastJoinCode } from '@/lib/storage'
import { useLiveQuery } from '@/lib/useLiveQuery'

/** The party this browser joined last, checked before it's offered; null if there's none (or it's gone). */
async function lastParty() {
  const code = lastJoinCode()
  if (!code) return null
  // Only a browser that joined has a stored code, so it's signed in; without a
  // session there's nothing to look the party up with, so offer the code as is.
  if (!(await currentUser())) return { code, name: null }
  const session = await getSessionByCode(code)
  if (!session) {
    forgetJoinCode(code)
    return null
  }
  return { code, name: session.name }
}

export default function Home() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const { data: last, error } = useLiveQuery(lastParty)
  // The start page shows once it knows whether there's a party to go back to.
  useLoaderHold(last === undefined && !error)

  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      <div className="flex flex-col gap-6">
        <div>
          <Logo className="size-16" />
          <h1 className="mt-4 text-3xl font-bold">Join the party</h1>
          <p className="mt-2 text-muted-foreground">Scan the QR code on the big screen, or type the party code.</p>
        </div>

        {last && (
          <Button asChild size="xl">
            <Link to={`/play/${last.code}`}>
              <span className="truncate">Continue in {last.name ?? `party ${last.code}`}</span>
              <ArrowRightIcon />
            </Link>
          </Button>
        )}

        <Card>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                navigate(`/join/${code.trim().toUpperCase()}`)
              }}
            >
              <Label htmlFor="code">Party code</Label>
              <Input
                id="code"
                className="font-mono text-lg tracking-widest uppercase md:text-lg"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
              />
              {/* Gold unless there's a party to continue, which is then the main way in. */}
              <Button type="submit" size="xl" variant={last ? 'secondary' : 'default'} disabled={!code.trim()}>
                Join
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Hosting the party?{' '}
          <Link
            to="/host"
            className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Host login
          </Link>
        </p>
      </div>
    </Screen>
  )
}
