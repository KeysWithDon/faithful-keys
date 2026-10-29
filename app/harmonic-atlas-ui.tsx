'use client';

/**
 * Faithful Keys — Harmonic Atlas.
 *
 * Isolated rendering keeps the 88-note neural field, demo synthesizer, 3D
 * animation and MIDI input independent of the main learning tools.
 * The resource is bundled in /public and works under both the GitHub Pages
 * /faithful-keys/ base path and root deployments.
 */
export default function HarmonicAtlas() {
  return (
    <section
      aria-label="Harmonic Atlas — neural visualization and harmony teacher"
      style={{ width: '100%', background: '#05090e', minHeight: 'calc(100dvh - 64px)' }}
    >
      <iframe
        title="Harmonic Atlas — live 88-note MIDI neural lattice"
        src="./harmonic-atlas.html"
        allow="midi; autoplay"
        style={{
          display: 'block',
          width: '100%',
          height: 'calc(100dvh - 64px)',
          minHeight: 540,
          border: 0,
          background: '#05090e',
        }}
      />
    </section>
  );
}
