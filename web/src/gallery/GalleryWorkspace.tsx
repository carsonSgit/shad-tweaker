import {
  type GalleryFixture,
  type GalleryFixtureKind,
  getGalleryFixtures,
  type StudioSummary,
  type WorkbenchArea,
} from '@studio-shared';
import { useEffect, useMemo, useState } from 'react';

const SECTIONS: Array<{ kind: GalleryFixtureKind; title: string; blurb: string }> = [
  {
    kind: 'component',
    title: 'Component Cards',
    blurb: 'Sample components you can open in the preview playground and restyle.',
  },
  {
    kind: 'primitive',
    title: 'Primitive Starters',
    blurb: 'Wrapper scaffolds for Radix, Base UI, and blank primitives.',
  },
  {
    kind: 'token-preset',
    title: 'Token Presets',
    blurb: 'Before/after token swaps you can apply across the whole library.',
  },
  {
    kind: 'variant-recipe',
    title: 'Variant Recipes',
    blurb: 'New variant axes and values for existing cva/tv definitions.',
  },
  {
    kind: 'motion-preset',
    title: 'Motion Presets',
    blurb: 'Enter/exit animation recipes with reduced-motion fallbacks.',
  },
  {
    kind: 'loader',
    title: 'Braille Loaders',
    blurb: 'Compact CLI-style spinners, customizable in the loader playground.',
  },
];

/**
 * Browsable gallery of fixtures; every card launches the matching playground
 * area, preselecting the referenced component when one exists locally.
 */
export function GalleryWorkspace({
  summary,
  setArea,
  setSelectedPaths,
}: {
  summary: StudioSummary;
  setArea: (area: WorkbenchArea) => void;
  setSelectedPaths: (paths: Set<string>) => void;
}) {
  const [fixtures, setFixtures] = useState<GalleryFixture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    getGalleryFixtures().then((result) => {
      if (result.success && result.data) {
        setFixtures(result.data.fixtures);
      } else {
        setError(result.error?.message || 'Failed to load gallery fixtures.');
      }
    });
  }, []);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return fixtures;
    return fixtures.filter((fixture) =>
      [fixture.title, fixture.description, ...fixture.tags].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [fixtures, filter]);

  function launch(fixture: GalleryFixture) {
    if (fixture.componentName) {
      const match = summary.components.inventory.find(
        (component) => component.name === fixture.componentName
      );
      if (match) setSelectedPaths(new Set([match.path]));
    }
    setArea(fixture.targetArea as WorkbenchArea);
  }

  if (error) {
    return (
      <section className="panel error">
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="panel gallery-workspace">
      <div className="preview-toolbar">
        <label>
          Filter examples
          <input
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search by name, tag, or description"
            value={filter}
          />
        </label>
      </div>

      {SECTIONS.map((section) => {
        const sectionFixtures = filtered.filter((fixture) => fixture.kind === section.kind);
        if (sectionFixtures.length === 0) return null;
        return (
          <section className="preview-section" key={section.kind}>
            <h2>{section.title}</h2>
            <p className="preview-note">{section.blurb}</p>
            <div className="gallery-grid">
              {sectionFixtures.map((fixture) => (
                <article className="gallery-card" key={fixture.id}>
                  <strong>{fixture.title}</strong>
                  <span>{fixture.description}</span>
                  {fixture.before || fixture.after ? (
                    <div className="gallery-before-after">
                      {fixture.before ? (
                        <code className="gallery-before">{fixture.before}</code>
                      ) : null}
                      {fixture.before && fixture.after ? <span>→</span> : null}
                      {fixture.after ? (
                        <code className="gallery-after">{fixture.after}</code>
                      ) : null}
                    </div>
                  ) : null}
                  <small>{fixture.tags.join(' · ')}</small>
                  <button onClick={() => launch(fixture)} type="button">
                    Open in playground
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && fixtures.length > 0 ? (
        <p className="preset-empty">No gallery examples match “{filter}”.</p>
      ) : null}
    </section>
  );
}
