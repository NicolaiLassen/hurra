import { ScanIcon, SignOutIcon } from '@phosphor-icons/react'
import { Link, Outlet, useNavigate } from 'react-router'
import Logo from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

export default function HostLayout() {
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/host/login', { replace: true })
  }

  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          <Button asChild variant="ghost" size="lg" className="font-bold">
            <Link to="/host">
              <Logo className="size-6 rounded-md ring-0" />
              Host
            </Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link to="/host/scan">
              <ScanIcon />
              Scan player
            </Link>
          </Button>
          <Button variant="ghost" size="lg" className="ml-auto text-muted-foreground" onClick={() => void signOut()}>
            <SignOutIcon />
            {/* Icon only on small phones, so the nav fits in one row at 320 to 375px. */}
            <span className="max-sm:sr-only">Sign out</span>
          </Button>
        </nav>
      </header>
      <Outlet />
    </>
  )
}
