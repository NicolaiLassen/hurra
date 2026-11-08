import { SpinnerIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isHost } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

/**
 * Where to go after signing in: the page that asked for the login, or the
 * sessions. Only a path in this app: browsers read a backslash as a slash, so
 * "/\x" would leave the site just like "//x".
 */
function returnPath(state: unknown) {
  const from = (state as { from?: unknown } | null)?.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.includes('\\')
    ? from
    : '/host'
}

export default function HostLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function signIn() {
    setBusy(true)
    setError(undefined)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && (await isHost())) {
      navigate(returnPath(location.state), { replace: true })
      return
    }
    if (!error) await supabase.auth.signOut()
    setError(error?.message ?? 'This account is not a host.')
    setBusy(false)
  }

  return (
    <Screen>
      <Logo className="mx-auto mt-[10dvh] size-14" />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Host login</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void signIn()
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="xl" disabled={busy}>
              {busy && <SpinnerIcon className="animate-spin" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Not the host?{' '}
        <Link to="/" className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
          Join the party
        </Link>
      </p>
    </Screen>
  )
}
