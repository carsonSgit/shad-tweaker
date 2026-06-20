import {
  analyzePixelInspector,
  applyPixelInspector,
  applyVariantGeneration,
  createPixelInspectorPreset,
  deletePixelInspectorPreset,
  getPixelInspectorPresets,
  type PixelInspectorAnalysis,
  type PixelInspectorClassCandidate,
  type PixelInspectorSaveMode,
  type Preset,
  previewPixelInspector,
  type StudioSummary,
} from '@studio-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PreviewFrame } from '../preview/PreviewFrame';
import { createInitialSelection } from '../preview/previewState';
import { PresetBrowser } from './PresetBrowser';

interface PixelInspectorWorkspaceProps {
  selectedComponents: StudioSummary['components']['inventory'];
  summary: StudioSummary;
}

export function PixelInspectorWorkspace({
  selectedComponents,
  summary,
}: PixelInspectorWorkspaceProps) {
  const components =
    selectedComponents.length > 0 ? selectedComponents : summary.components.inventory;
  const [componentPath, setComponentPath] = useState(components[0]?.path ?? '');
  const [analysis, setAnalysis] = useState<PixelInspectorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClass, setSelectedClass] = useState('');
  const [replacementClass, setReplacementClass] = useState('');
  const [rawClassName, setRawClassName] = useState('');
  const [saveMode, setSaveMode] = useState<PixelInspectorSaveMode>('component-patch');
  const [tokenSetId, setTokenSetId] = useState(summary.tokens.tokenSets[0]?.id ?? '');
  const [presetName, setPresetName] = useState('Pixel Inspector Preset');
  const [variantDefinition, setVariantDefinition] = useState('');
  const [variantValue, setVariantValue] = useState('inspected');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);

  const reloadPresets = useCallback(async () => {
    const result = await getPixelInspectorPresets();
    if (result.success && result.data) {
      setPresets(result.data.presets);
    }
  }, []);

  useEffect(() => {
    void reloadPresets();
  }, [reloadPresets]);

  useEffect(() => {
    if (!componentPath && components[0]) {
      setComponentPath(components[0].path);
    }
  }, [componentPath, components]);

  useEffect(() => {
    if (!componentPath) return;
    let active = true;
    setError(null);
    analyzePixelInspector(componentPath).then((result) => {
      if (!active) return;
      if (result.success && result.data) {
        setAnalysis(result.data.analysis);
        const firstClass = result.data.analysis.candidates[0]?.className ?? '';
        setSelectedClass(firstClass);
        setReplacementClass(firstClass);
        setRawClassName(result.data.analysis.rawClasses.join(' '));
      } else {
        setAnalysis(null);
        setError(result.error?.message || 'Could not analyze component classes.');
      }
    });
    return () => {
      active = false;
    };
  }, [componentPath]);

  const classCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of analysis?.candidates ?? []) {
      counts.set(candidate.group, (counts.get(candidate.group) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [analysis]);

  const candidatesByGroup = useMemo(() => {
    const groups = new Map<string, PixelInspectorClassCandidate[]>();
    for (const candidate of analysis?.candidates ?? []) {
      groups.set(candidate.group, [...(groups.get(candidate.group) ?? []), candidate]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [analysis]);

  const selection = useMemo(
    () => ({
      ...createInitialSelection(componentPath),
      inspectorClassName: rawClassName.trim() || undefined,
    }),
    [componentPath, rawClassName]
  );

  const draft = useMemo(
    () => ({
      componentPath,
      targetClasses: selectedClass ? [selectedClass] : [],
      replacementClasses: replacementClass ? [replacementClass] : [],
      rawClassName,
      saveMode,
      tokenSetId: tokenSetId || undefined,
      tokenName: selectedClass ? `${selectedClass}-override` : undefined,
      presetName,
      variantDefinition: variantDefinition || undefined,
      variantAxis: 'variant',
      variantValue,
    }),
    [
      componentPath,
      presetName,
      rawClassName,
      replacementClass,
      saveMode,
      selectedClass,
      tokenSetId,
      variantDefinition,
      variantValue,
    ]
  );

  async function previewDraft() {
    const result = await previewPixelInspector({ draft });
    if (result.success && result.data) {
      setResultMessage(`${result.data.totalChanges} class changes previewed.`);
    } else {
      setResultMessage(result.error?.message || 'Preview failed.');
    }
  }

  async function saveDraft() {
    if (saveMode === 'preset') {
      const result = await createPixelInspectorPreset({ name: presetName, draft });
      if (result.success && result.data) {
        setResultMessage(`Preset saved: ${result.data.preset.name}`);
        await reloadPresets();
      } else {
        setResultMessage(result.error?.message || 'Preset save failed.');
      }
      return;
    }
    if (saveMode === 'variant-value') {
      const result = await applyVariantGeneration({
        componentPath,
        targetDefinition: draft.variantDefinition || '',
        operation: {
          type: 'add-value',
          axisName: draft.variantAxis || 'variant',
          value: { name: variantValue, classes: rawClassName.split(/\s+/).filter(Boolean) },
        },
      });
      setResultMessage(
        result.success && result.data
          ? `Variant saved with backup ${result.data.result.backupId ?? 'none'}.`
          : result.error?.message || 'Variant save failed.'
      );
      return;
    }
    const result = await applyPixelInspector({
      draft,
      recordOverrides: saveMode === 'token-patch',
    });
    setResultMessage(
      result.success && result.data
        ? `${result.data.result.changes} changes saved.`
        : result.error?.message || 'Save failed.'
    );
  }

  function applyPreset(preset: Preset) {
    const [first] = preset.classTransforms;
    if (!first) {
      setResultMessage(`Preset ${preset.name} has no class changes to apply.`);
      return;
    }
    setSaveMode('component-patch');
    setSelectedClass(first.find);
    setReplacementClass(first.replace);
    setRawClassName((current) =>
      current
        .split(/\s+/)
        .map((className) => (className === first.find ? first.replace : className))
        .join(' ')
    );
    setResultMessage(`Loaded preset ${preset.name} into the draft.`);
  }

  async function removePreset(id: string) {
    const result = await deletePixelInspectorPreset(id);
    if (result.success) {
      await reloadPresets();
      setResultMessage('Preset deleted.');
    } else {
      setResultMessage(result.error?.message || 'Could not delete preset.');
    }
  }

  if (components.length === 0) {
    return <section className="panel">No components found.</section>;
  }

  return (
    <section className="panel pixel-inspector">
      <div className="preview-toolbar">
        <label>
          Component
          <select onChange={(event) => setComponentPath(event.target.value)} value={componentPath}>
            {components.map((component) => (
              <option key={component.path} value={component.path}>
                {component.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <div className="preview-diagnostic">{error}</div> : null}
      {analysis ? (
        <div className="pixel-inspector-grid">
          <div className="pixel-inspector-panel">
            <h2>Class Inspector</h2>
            <div className="pixel-class-groups">
              {classCountByGroup.map(([group, count]) => (
                <span key={group}>
                  {group} <strong>{count}</strong>
                </span>
              ))}
            </div>
            <label>
              Target class
              <select
                onChange={(event) => {
                  setSelectedClass(event.target.value);
                  setReplacementClass(event.target.value);
                }}
                value={selectedClass}
              >
                {candidatesByGroup.map(([group, candidates]) => (
                  <optgroup key={group} label={group}>
                    {candidates.map((candidate) => (
                      <option
                        key={`${candidate.source}:${candidate.line}:${candidate.className}`}
                        value={candidate.className}
                      >
                        {candidate.className}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Replacement
              <input
                onChange={(event) => {
                  const next = event.target.value;
                  setReplacementClass(next);
                  setRawClassName((current) =>
                    current
                      .split(/\s+/)
                      .map((className) => (className === selectedClass ? next : className))
                      .join(' ')
                  );
                }}
                value={replacementClass}
              />
            </label>
            <label>
              Raw classes
              <textarea
                onChange={(event) => setRawClassName(event.target.value)}
                rows={6}
                value={rawClassName}
              />
            </label>
            <label>
              Save as
              <select
                onChange={(event) => setSaveMode(event.target.value as PixelInspectorSaveMode)}
                value={saveMode}
              >
                <option value="component-patch">Component patch</option>
                <option value="token-patch">Token patch</option>
                <option value="variant-value">Variant value</option>
                <option value="preset">Reusable preset</option>
              </select>
            </label>
            {saveMode === 'token-patch' ? (
              <label>
                Token set
                <select onChange={(event) => setTokenSetId(event.target.value)} value={tokenSetId}>
                  {summary.tokens.tokenSets.map((tokenSet) => (
                    <option key={tokenSet.id} value={tokenSet.id}>
                      {tokenSet.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {saveMode === 'preset' ? (
              <label>
                Preset name
                <input onChange={(event) => setPresetName(event.target.value)} value={presetName} />
              </label>
            ) : null}
            {saveMode === 'variant-value' ? (
              <>
                <label>
                  Variant definition
                  <input
                    onChange={(event) => setVariantDefinition(event.target.value)}
                    placeholder="buttonVariants"
                    value={variantDefinition}
                  />
                </label>
                <label>
                  Variant value
                  <input
                    onChange={(event) => setVariantValue(event.target.value)}
                    value={variantValue}
                  />
                </label>
              </>
            ) : null}
            <div className="actions">
              <button onClick={previewDraft} type="button">
                Preview patch
              </button>
              <button onClick={saveDraft} type="button">
                Save
              </button>
            </div>
            {resultMessage ? <p>{resultMessage}</p> : null}
          </div>
          <PreviewFrame
            label="Inspector preview"
            manifest={{
              component: { name: componentPath, path: componentPath, exports: [], defaultExport: '' },
              variants: [],
              states: ['default'],
              viewports: { desktop: { width: 1200, height: 720 }, tablet: { width: 768, height: 720 }, mobile: { width: 390, height: 720 } },
              themes: ['light', 'dark', 'system'],
              densities: ['comfortable', 'default', 'compact'],
              frameUrl: `/studio/preview/frame?componentPath=${encodeURIComponent(componentPath)}`,
              diagnostics: [],
            }}
            selection={selection}
          />
        </div>
      ) : null}
      <PresetBrowser presets={presets} onApply={applyPreset} onDelete={removePreset} />
    </section>
  );
}
