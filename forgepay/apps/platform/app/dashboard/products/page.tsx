'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PageHeader,
  Panel,
  Pill,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Product selection — the real catalog from unified-router
   (services/.../db/migrations/002_product_topology.sql), including
   which products are actually available today vs waitlisted or
   gated on a licence that hasn't been granted yet. A product not
   turned on here doesn't appear in the sidebar and its pages
   redirect back here if visited directly.
   ──────────────────────────────────────────────────────────────── */

interface CatalogProduct {
  key: string;
  name: string;
  tagline: string | null;
  availability: 'available' | 'waitlist' | 'private' | 'retired';
  requires: string[];
}

const AVAILABILITY_LABEL: Record<CatalogProduct['availability'], string> = {
  available: 'available',
  waitlist: 'waitlist — not production-ready yet',
  private: 'requires a licence FORGE doesn’t hold yet',
  retired: 'retired',
};

export default function ProductSelection() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tenant/products').then((r) => r.json()).then((body) => {
      setCatalog(body.catalog ?? []);
      setSelected(new Set(body.enabled ?? []));
    });
  }, []);

  const toggle = (key: string, availability: CatalogProduct['availability']) => {
    if (availability !== 'available') return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch('/api/tenant/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: Array.from(selected) }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setError(body?.message ?? 'Could not save your selection.');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Products"
        title={
          <>
            Turn on what <em>you</em> need
          </>
        }
        lede="Only what you enable shows up in your console. Nothing here is pre-selected — pick the products you actually want, and change this anytime."
      />

      <Panel title="Product Catalog" label="from unified-router's real product table">
        {!catalog ? (
          <p className="lede" style={{ fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1, background: 'var(--hair)', border: '1px solid var(--hair)' }}>
            {catalog.map((p) => {
              const isSelected = selected.has(p.key);
              const disabled = p.availability !== 'available';
              return (
                <button
                  key={p.key}
                  onClick={() => toggle(p.key, p.availability)}
                  disabled={disabled}
                  style={{
                    textAlign: 'left',
                    background: 'var(--paper)',
                    padding: 20,
                    border: `2px solid ${isSelected ? 'var(--ink)' : 'transparent'}`,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 15 }}>{p.name}</strong>
                    {isSelected && <Pill tone="ok">on</Pill>}
                  </div>
                  {p.tagline && <span style={{ fontSize: 12.5, color: 'var(--steel)' }}>{p.tagline}</span>}
                  <span className="mono" style={{ fontSize: 10, color: disabled ? 'var(--danger)' : 'var(--steel)' }}>
                    {AVAILABILITY_LABEL[p.availability]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {error && <p className="lede" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 14 }}>{error}</p>}
        <div style={{ marginTop: 20 }}>
          <button className="btn-primary" onClick={save} disabled={saving || !catalog}>
            {saving ? 'Saving…' : 'Save selection'}
          </button>
        </div>
      </Panel>
    </>
  );
}
