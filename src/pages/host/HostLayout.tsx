import { ScanIcon, SignOutIcon } from '@phosphor-icons/react'
import { Link, Outlet, useNavigate, useNavigation } from 'react-router'
import { errorMessage } from '@/components/host/hostCalls'
import Logo from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth'
import { useLoaderHold } from '@/lib/loader'
import { toast } from '@/lib/toast'

export default function HostLayout() {
  const navigate = useNavigate()
  // The host pages load on demand: a slow one shows the loader instead of nothing happening.
  useLoaderHold(useNavigation().state === 'loading')

  async function leave() {
    try {
      await signOut()
    } catch (error) {
      toast.error(errorMessage(error))
      return
    }
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
          <Button variant="ghost" size="lg" className="ml-auto text-muted-foreground" onClick={() => void leave()}>
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
