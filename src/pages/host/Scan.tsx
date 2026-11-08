import { useNavigate } from 'react-router'
import { Screen } from '@/components/layout'
import QrScanner from '@/components/QrScanner'

export default function Scan() {
  const navigate = useNavigate()

  return (
    <Screen>
      <h1 className="mb-6 text-3xl font-bold">Scan a player</h1>
      <QrScanner onCode={(code) => navigate(`/p/${code}`)} />
    </Screen>
  )
}
