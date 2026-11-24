import { useNavigate, useSearchParams } from 'react-router'
import { Screen } from '@/components/layout'
import QrScanner from '@/components/QrScanner'
import { isUuid } from '@/lib/urls'

/**
 * Scan a player's QR code to give them points. `?game=<id>` (from a game's
 * Scan a player, or the award page's Scan next) goes along to the award page,
 * so the points go to that game even with two rounds live.
 */
export default function Scan() {
  const navigate = useNavigate()
  const game = useSearchParams()[0].get('game')
  const suffix = game && isUuid(game) ? `?game=${game}` : ''

  return (
    <Screen>
      <h1 className="mb-6 text-3xl font-extrabold">Scan a player</h1>
      <QrScanner onCode={(code) => navigate(`/p/${code}${suffix}`)} />
    </Screen>
  )
}
