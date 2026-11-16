// Dev builds only: router.tsx adds /dev/tokens under import.meta.env.DEV, so a
// production build has neither the route nor this file. The token sheet,
// docs/identity.md's acceptance test: the fixtures' 24 guests with the real
// Avatar at the sizes the screens use (24 to 32 px in lists and rows, 38 px
// in the TV's field, 64 px in the top five and on the podium, 120 and 200 px
// as heroes), with and without a photo, in and knocked out. The photos are the
// dev builds' drawn faces, found the way every screen finds one: by name,
// through the party's photo index.
import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'
import { devTv } from '@/components/tv/devFixture'
import { GUEST_COLORS, GUEST_PIECES, guestLook, type GuestLook } from '@/lib/guest'
import { PhotosContext, type PhotoIndex } from '@/lib/photoIndex'
import { drawnFace } from '@/lib/photos'
import { cn } from '@/lib/utils'

const GUESTS = (devTv(new URLSearchParams('fixture=lobby&players=24'))?.snapshot.players ?? []).map((p) => p.name)
/** Every other guest has a photo, so each row shows both. */
const hasPhoto = (i: number) => i % 2 === 1
/** The last six of the field are out, three with a photo and three without. */
const fieldOut = (i: number) => i >= GUESTS.length - 6

/** Long names and short ones, beyond the fixtures' first 24. */
const HEROES = ['Christoffer Bjørnskov', 'Marie-Louise Christensen', 'Josefine', 'Valdemar', 'Ida']

/** Names to find each colour and piece in, for the grid of all 18 pairs. */
const MORE_NAMES = [
  ...GUESTS,
  'Agnes', 'Liva', 'Laura', 'Lucas', 'Luna', 'Magnus', 'Malthe', 'Mathilde', 'Nora', 'Olivia', 'Otto', 'Silje', 'Storm',
  'Theo', 'Victor', 'Vigga', 'William', 'Viggo', 'Karla', 'Konrad', 'Johan', 'Ingrid', 'Hannah', 'Gustav', 'Frida',
  'Frederik', 'Anne', 'Mette', 'Søren', 'Jens', 'Peter', 'Kirsten', 'Hanne', 'Niels', 'Rasmus', 'Signe', 'Julie',
  'Louise', 'Inge',
]

const PHOTOS: PhotoIndex = {
  byId: new Map(),
  byName: new Map(
    [...GUESTS.filter((_, i) => hasPhoto(i)), 'Ana', 'Emil'].map((name) => [name, drawnFace(name)] as const),
  ),
}

const firstName = (name: string) => name.split(' ')[0]

export default function TokenSheet() {
  return (
    <PhotosContext.Provider value={PHOTOS}>
      <main className="min-h-dvh px-24 py-16 text-paper">
        <h1 className="wide text-[44px] leading-none">One token per guest</h1>
        <p className="mt-3.5 max-w-[1500px] text-[26px] leading-[1.35] font-medium text-paper-2">
          A photo when there is one, with a band in the guest's colour. Without a photo, the guest's colour and their
          piece, one of the logo's confetti pieces. From 96 px the whole first name, never cropped. A pink stripe, and
          the word Out beside the name, when they are knocked out.
        </p>

        <Label note="the name is always printed beside it">TV field, 38 px</Label>
        <Row>
          {GUESTS.map((name, i) => (
            <Token key={name} name={name} size="size-[38px]" photo={hasPhoto(i)} out={fieldOut(i)} />
          ))}
        </Row>

        <Label note="phone and host lists, the board's rows; where the stripe is thinnest">Lists, 24, 28 and 32 px</Label>
        {['size-6', 'size-7', 'size-8'].map((size) => (
          <Row key={size}>
            {GUESTS.slice(0, 12).map((name, i) => (
              <Token key={name} name={name} size={size} photo={hasPhoto(i)} out={i >= 8} />
            ))}
          </Row>
        ))}

        <Label>TV top five and the podium, 64 px</Label>
        <Row>
          {GUESTS.slice(0, 12).map((name, i) => (
            <Token key={name} name={name} size="size-16" photo={hasPhoto(i)} out={i >= 10} />
          ))}
        </Row>

        <Label note="the leader, the winner, a guest's own phone">Heroes, 120 and 200 px</Label>
        <Row className="gap-7">
          <Token name="Bo" size="size-[200px]" />
          <Token name="Sofie" size="size-[200px]" />
          {HEROES.map((name) => (
            <Token key={name} name={name} size="size-[120px]" />
          ))}
          <Token name="Ana" size="size-[120px]" photo />
          <Token name="Lars" size="size-[120px]" out />
          <Token name="Emil" size="size-[120px]" photo out />
        </Row>

        <Label note="the smallest token with a name, and one pixel under it">The switch, 95 and 96 px</Label>
        <Row className="gap-7">
          {['Christoffer', 'Marie-Louise', 'Bo'].flatMap((name) => [
            <Token key={`${name}95`} name={name} size="size-[95px]" />,
            <Token key={`${name}96`} name={name} size="size-24" />,
          ])}
        </Row>

        <Label note="every name fitted at the smallest size that shows it">Every guest at 96 px</Label>
        <Row>
          {GUESTS.map((name) => (
            <Token key={name} name={name} size="size-24" />
          ))}
        </Row>

        <Label note="six colours times three pieces, keyed on the name">All 18 pairs, 64 px</Label>
        <Pairs />
      </main>
    </PhotosContext.Provider>
  )
}

/** A token with its name under it, and the word Out when out. Names given a photo here show it. */
function Token({ name, size, photo = false, out = false }: { name: string; size: string; photo?: boolean; out?: boolean }) {
  return (
    <figure className="flex min-w-16 flex-col items-center gap-2">
      <Avatar name={name} src={photo ? undefined : null} out={out} className={size} />
      <figcaption className="text-[15px] font-semibold whitespace-nowrap text-paper-2">
        {firstName(name)}
        {out && <span className="ml-1 font-bold text-pink">Out</span>}
      </figcaption>
    </figure>
  )
}

/** The first name in MORE_NAMES with each colour and piece. */
function Pairs() {
  const found = new Map<string, string>()
  for (const name of MORE_NAMES) {
    const { color, piece } = guestLook(name)
    if (!found.has(`${color} ${piece}`)) found.set(`${color} ${piece}`, name)
  }
  const pairs: GuestLook[] = GUEST_PIECES.flatMap((piece) => GUEST_COLORS.map((color) => ({ color, piece })))
  return (
    <div className="mt-3.5 grid w-fit grid-cols-6 gap-x-6 gap-y-4">
      {pairs.map(({ color, piece }) => {
        const name = found.get(`${color} ${piece}`)
        return (
          <figure key={`${color} ${piece}`} className="flex flex-col items-center gap-2">
            {name ? <Avatar name={name} src={null} className="size-16" /> : <span className="size-16 rounded-token bg-raised" />}
            <figcaption className="text-center text-[15px] leading-tight font-semibold text-paper-2">
              {color} {piece}
              <br />
              <span className="font-medium text-paper-3">{name ?? 'no name yet'}</span>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

function Label({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <h2 className="mt-9 text-xl font-bold">
      {children}
      {note && <small className="ml-2.5 text-lg font-medium text-paper-2">{note}</small>}
    </h2>
  )
}

function Row({ children, className = 'gap-3.5' }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-3.5 flex flex-wrap items-end', className)}>{children}</div>
}
