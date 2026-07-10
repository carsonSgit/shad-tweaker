import { BRAILLE_LOADER_PRESETS } from '../data/brailleLoaders.js';
import { GALLERY_FIXTURES } from '../data/galleryFixtures.js';
import type { GalleryFixture } from '../types/index.js';
import { listPrimitiveStarterTemplates } from './primitiveStarters.js';

/**
 * Assembles the full gallery: curated fixtures plus dynamic entries derived
 * from the primitive starter and braille loader catalogs, so every gallery
 * card shares one fixture format the playground can launch from.
 */
export function listGalleryFixtures(): GalleryFixture[] {
  const primitives: GalleryFixture[] = listPrimitiveStarterTemplates().map((template) => ({
    id: `primitive-${template.id}`,
    kind: 'primitive',
    title: template.name,
    description: template.description,
    tags: ['primitive', template.provider, ...(template.supportsCva ? ['cva'] : [])],
    targetArea: 'components',
    data: { provider: template.provider, templateId: template.id },
  }));

  const loaders: GalleryFixture[] = BRAILLE_LOADER_PRESETS.map((preset) => ({
    id: `loader-${preset.id}`,
    kind: 'loader',
    title: `${preset.name} loader`,
    description: preset.description,
    tags: ['loader', 'braille', ...preset.tags],
    targetArea: 'loaders',
    before: preset.reducedMotionFrame,
    after: preset.frames.join(''),
    data: { presetId: preset.id, intervalMs: preset.intervalMs, frames: preset.frames },
  }));

  return [...GALLERY_FIXTURES, ...primitives, ...loaders];
}
