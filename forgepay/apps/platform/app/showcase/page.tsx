'use client';

import { useEffect, useState } from 'react';
import { PlatformShowcase } from '@/components/forge/PlatformShowcase';

/**
 * Full-viewport showcase. `?capture=1` hides controls and plays once, for
 * recording to video (scripts/record-showcase.mjs).
 */
export default function ShowcasePage() {
  const [capture, setCapture] = useState<boolean | null>(null);
  useEffect(() => {
    setCapture(new URLSearchParams(window.location.search).get('capture') === '1');
  }, []);
  if (capture === null) return null;
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0A0A0A', padding: capture ? 0 : 24 }}>
      <div style={{ width: capture ? '100vw' : 'min(1200px, 100%)' }}>
        <PlatformShowcase capture={capture} loop={!capture} />
      </div>
    </main>
  );
}
