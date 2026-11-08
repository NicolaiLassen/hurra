import { ScanIcon } from '@phosphor-icons/react'
import { useCallback } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { ErrorNotice, Loading, Notice } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { currentUser, isHost } from '@/lib/auth'
import { getOwnPlayer, getPlayerByCode } from '@/lib/queries'
import { lastJoinCode } from '@/lib/storage'
import { useLiveQuery } from '@/lib/useLiveQuery'
import AwardPoints from '@/pages/host/AwardPoints'
import { WayBack } from '@/pages/NotFound'

// Target of every player QR code. The host gets the scoring screen. A player
// of the same party goes into their game with the code (games that take codes
// use it, e.g. to knock that player out); anyone else sees whose code it is.
export default function PlayerCard() {
  const code = (useParams().playerCode ?? '').toUpperCase()
  const load = useCallback(async () => {
    const user = await currentUser()
    if (!user) return { userId: null, host: false, player: null, inSameParty: false }
    const [host, player] = await Promise.all([isHost(), getPlayerByCode(code)])
    const inSameParty = !host && player !== null && (await getOwnPlayer(player.session_id, user.id)) !== null
    return { userId: user.id, host, player, inSameParty }
  }, [code])
  const { data, error, retry } = useLiveQuery(load)

  if (error) return <ErrorNotice error={error} onRetry={retry} />
  if (!data) return <Loading />

  const { host, player, userId, inSameParty } = data
  // Nobody is signed in on this browser, so the code can't be looked up: it may
  // well be real. Say what it is and offer the host's way in.
  if (!userId) {
    return (
      <Notice
        title="Player code"
        actions={
          <>
            <Button asChild size="xl">
              <Link to="/host/login" state={{ from: `/p/${code}` }}>
                Host login
              </Link>
            </Button>
            <WayBack back="start" variant="secondary" />
          </>
        }
      >
        Only the host can give points with this code.
      </Notice>
    )
  }
  if (host) {
    return player ? (
      <AwardPoints player={player} session={player.session} />
    ) : (
      <Notice
        title="Unknown player"
        actions={
          <>
            <Button asChild size="xl">
              <Link to="/host/scan">
                <ScanIcon />
                Scan again
              </Link>
            </Button>
            <WayBack back="host" variant="secondary" />
          </>
        }
      >
        There's no player with the code {code}. They may have been removed, or the code is wrong.
      </Notice>
    )
  }

  if (player && inSameParty && player.user_id !== userId) {
    return <Navigate to={`/play/${player.session.join_code}?scanned=${player.code}`} replace />
  }

  // Guests go back to their own game: the one this code belongs to, or the last one they joined.
  const gameCode = player && player.user_id === userId ? player.session.join_code : lastJoinCode()
  const back = gameCode ? (
    <Button asChild size="xl">
      <Link to={`/play/${gameCode}`}>Back to the game</Link>
    </Button>
  ) : (
    <WayBack back="start" />
  )

  if (player && player.user_id === userId) {
    return (
      <Notice title="This is your QR code" actions={back}>
        Show it to the host when you score.
      </Notice>
    )
  }
  if (!player) {
    return (
      <Notice title="Unknown code" actions={back}>
        There's no player with the code {code}. They may have left the party, or the code is wrong.
      </Notice>
    )
  }
  return (
    <Notice title={`${player.name}'s player code`} actions={back}>
      Only the host can give points with this code.
    </Notice>
  )
}
