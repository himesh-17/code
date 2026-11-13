"use client"

import { useEffect, useState } from 'react'

// AsciiArt — "lol", made with the 21st ASCII editor and baked
// to its exact rendered output (looping video + poster). Zero dependencies:
// one <video> that fills its parent. Drop it behind or inside your content:
// <div className="relative h-96"><AsciiArt className="absolute inset-0" /></div>
// Remix the source recipe (styles, animation, palette) in the editor:
// https://21st.dev/community/ascii/editor?from=deec7b29-e2fc-4377-89aa-f2c9b8d681f4
//
// The clip is ~350 kB, so it is never on the critical path: the poster paints
// immediately and the video is fetched only once the page is idle. Users who
// ask for reduced motion keep the poster and never download it.
const VIDEO =
  'https://assets.21st.dev/ascii-recipes/videos/user_3GipwIJrMw3ZdAWF5gPrHE3Xeds/6fca651a-910f-433b-9360-7af71cdf6b12.mp4'
const POSTER =
  'https://assets.21st.dev/ascii-recipes/thumbnails/user_3GipwIJrMw3ZdAWF5gPrHE3Xeds/678abc69-c39c-4d9a-b8bf-630de02722ca.webp'

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

export function AsciiArt({ className }: { className?: string }) {
  const [src, setSrc] = useState<string>()

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const w = window as IdleWindow
    const load = () => setSrc(VIDEO)
    const id = w.requestIdleCallback
      ? w.requestIdleCallback(load, { timeout: 2500 })
      : window.setTimeout(load, 2500)
    return () => {
      if (w.cancelIdleCallback && typeof id === 'number') w.cancelIdleCallback(id)
      else window.clearTimeout(id as number)
    }
  }, [])

  return (
    <video
      className={className}
      src={src}
      poster={POSTER}
      preload="none"
      autoPlay={!!src}
      loop
      muted
      playsInline
      aria-label={'lol — animated ASCII art'}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
      }}
    />
  )
}
