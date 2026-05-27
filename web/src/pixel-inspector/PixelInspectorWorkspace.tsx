import {
  analyzePixelInspector,
  type PixelInspectorAnalysis,
  type PixelInspectorClassCandidate,
  type StudioSummary,
} from '@studio-shared';
import { useEffect, useMemo, useState } from 'react';
import { PreviewFrame } from '../preview/PreviewFrame';
import { createInitialSelection } from '../preview/previewState';

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
    </section>
  );
}
