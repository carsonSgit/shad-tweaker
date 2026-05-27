import {
  getStudioSummary,
  getWorkbenchAreaMeta,
  type StudioSummary,
  updateWorkspaceConfig,
  WORKBENCH_AREAS,
  type WorkbenchArea,
  type WorkspaceConfig,
} from '@studio-shared';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewWorkspace } from './preview/PreviewWorkspace';
import './styles.css';

function backupComponentCount(backup: StudioSummary['backups']['backups'][number]): number {
  return backup.components;
}

function activeTokenCategories(summary: StudioSummary | null): string[] {
  const categories = new Set<string>();
  for (const tokenSet of summary?.tokens.tokenSets ?? []) {
    for (const [category, tokens] of Object.entries(tokenSet.tokens)) {
      if (Object.keys(tokens).length > 0) categories.add(category);
    }
  }
  return [...categories].sort();
}

function App() {
  const [area, setArea] = useState<WorkbenchArea>('components');
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [settingsDirty, setSettingsDirty] = useState(false);

  const dirty = selectedPaths.size > 0 || settingsDirty;
  const meta = getWorkbenchAreaMeta(area);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getStudioSummary();
    if (result.success && result.data) {
      setSummary(result.data);
    } else {
      setError(result.error?.message || 'Failed to load studio summary');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedComponents = useMemo(
    () =>
      (summary?.components.inventory ?? []).filter((component) =>
        selectedPaths.has(component.path)
      ),
    [summary, selectedPaths]
  );

  return (
    <main className="studio">
      <aside className="sidebar">
        <div className="brand">
          <strong>shadcn/tweaker</strong>
          <span>local studio</span>
        </div>
        <nav aria-label="Workbench areas">
          {WORKBENCH_AREAS.map((item, index) => (
            <button
              className={item.id === area ? 'active' : ''}
              key={item.id}
              onClick={() => setArea(item.id)}
              type="button"
            >
              <span>{index + 1}</span>
              {item.shortLabel}
            </button>
          ))}
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>{meta.label}</h1>
            <p>{meta.description}</p>
          </div>
          <div className={dirty ? 'dirty state' : 'clean state'}>
            {dirty ? 'Unapplied changes' : 'Clean'}
          </div>
        </header>

        <div className="project-strip">
          <span>{summary?.workspace.cwd ?? 'Loading project...'}</span>
          <span>{summary?.workspace.manifest.config.componentDirectory ?? 'components'}</span>
          <button onClick={refresh} type="button">
            Refresh
          </button>
        </div>

        {loading && !summary ? <div className="panel">Loading studio summary...</div> : null}
        {error && !summary ? <div className="panel error">{error}</div> : null}
        {summary ? (
          <AreaPanel
            area={area}
            selectedComponents={selectedComponents}
            selectedPaths={selectedPaths}
            setArea={setArea}
            setSelectedPaths={setSelectedPaths}
            setSettingsDirty={setSettingsDirty}
            summary={summary}
            onRefresh={refresh}
          />
        ) : null}
      </section>
    </main>
  );
}

function AreaPanel({
  area,
  selectedComponents,
  selectedPaths,
  setSelectedPaths,
  setSettingsDirty,
  summary,
  onRefresh,
}: {
  area: WorkbenchArea;
  selectedComponents: StudioSummary['components']['inventory'];
  selectedPaths: Set<string>;
  setSelectedPaths: (paths: Set<string>) => void;
  setSettingsDirty: (dirty: boolean) => void;
  summary: StudioSummary;
  onRefresh: () => Promise<void>;
}) {
  if (area === 'components') {
    return (
      <section className="panel">
        <div className="metrics">
          <Metric label="Components" value={summary.components.count} />
          <Metric label="Selected" value={selectedPaths.size} />
          <Metric label="With variants" value={summary.variants.components.length} />
        </div>
        <div className="table">
          {summary.components.inventory.length === 0 ? (
            <p>No components found in {summary.workspace.manifest.config.componentDirectory}.</p>
          ) : (
            summary.components.inventory.map((component) => (
              <label className="row" key={component.path}>
                <input
                  checked={selectedPaths.has(component.path)}
                  onChange={() => {
                    const next = new Set(selectedPaths);
                    if (next.has(component.path)) next.delete(component.path);
                    else next.add(component.path);
                    setSelectedPaths(next);
                  }}
                  type="checkbox"
                />
                <strong>{component.name}</strong>
                <span>{component.path}</span>
                <span>{component.variantCount} variants</span>
              </label>
            ))
          )}
        </div>
      </section>
    );
  }

  if (area === 'registries') {
    return (
      <section className="panel">
        <div className="metrics">
          <Metric label="Sources" value={summary.registries.sources.length} />
          <Metric
            label="Enabled"
            value={summary.registries.sources.filter((source) => source.enabled).length}
          />
          <Metric label="Items" value={summary.registries.items.length} />
        </div>
        {summary.registries.sources.map((source) => (
          <article className="card" key={source.id}>
            <strong>{source.name}</strong>
            <span>{source.type}</span>
            <span>{source.registryJsonUrl || source.baseUrl || 'local source'}</span>
          </article>
        ))}
      </section>
    );
  }

  if (area === 'tokens') {
    const categories = activeTokenCategories(summary);
    return (
      <section className="panel">
        <div className="metrics">
          <Metric label="Token sets" value={summary.tokens.tokenSets.length} />
          <Metric label="Categories" value={categories.length} />
          <Metric
            label="Inconsistencies"
            value={summary.tokens.inconsistencies?.entries.length ?? 0}
          />
        </div>
        <p>{categories.length > 0 ? categories.join(', ') : 'No active token categories yet.'}</p>
        {(summary.tokens.frequency?.entries ?? []).slice(0, 8).map((entry) => (
          <article className="card" key={`${entry.category}:${entry.value}`}>
            <strong>{entry.category}</strong>
            <span>{entry.value}</span>
            <span>{entry.occurrences} uses</span>
          </article>
        ))}
      </section>
    );
  }

  if (area === 'variants') {
    return (
      <section className="panel">
        <div className="metrics">
          <Metric label="Components" value={summary.variants.components.length} />
          <Metric
            label="Definitions"
            value={summary.variants.components.reduce((sum, item) => sum + item.variantCount, 0)}
          />
        </div>
        {summary.variants.components.map((component) => (
          <article className="card" key={component.path}>
            <strong>{component.name}</strong>
            <span>{component.systems.join(', ') || 'unknown system'}</span>
            <span>{component.axes.join(', ') || 'no axes detected'}</span>
          </article>
        ))}
      </section>
    );
  }

  if (area === 'motion') {
    const motion = activeTokenCategories(summary).filter((category) =>
      ['motion', 'easing', 'duration'].includes(category)
    );
    return (
      <section className="panel">
        <Metric label="Motion categories" value={motion.length} />
        <p>
          {motion.length > 0 ? motion.join(', ') : 'No motion, easing, or duration tokens found.'}
        </p>
      </section>
    );
  }

  if (area === 'preview') {
    return <PreviewWorkspace selectedComponents={selectedComponents} summary={summary} />;
  }

  if (area === 'diff') {
    const latestBackup = summary.backups.backups[0];
    return (
      <section className="panel">
        <p>Diffs appear after edit previews or backup preview selection.</p>
        {latestBackup ? (
          <article className="card">
            <strong>{latestBackup.id}</strong>
            <span>{backupComponentCount(latestBackup)} components</span>
          </article>
        ) : (
          <p>No backups available yet.</p>
        )}
      </section>
    );
  }

  if (area === 'backups') {
    return (
      <section className="panel">
        <Metric label="Backups" value={summary.backups.backups.length} />
        {summary.backups.backups.map((backup) => (
          <article className="card" key={backup.id}>
            <strong>{backup.id}</strong>
            <span>{new Date(backup.timestamp).toLocaleString()}</span>
            <span>{backupComponentCount(backup)} components</span>
          </article>
        ))}
      </section>
    );
  }

  return (
    <SettingsPanel
      config={summary.workspace.manifest.config}
      cwd={summary.workspace.cwd}
      onDirtyChange={setSettingsDirty}
      onRefresh={onRefresh}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SettingsPanel({
  config,
  cwd,
  onDirtyChange,
  onRefresh,
}: {
  config: WorkspaceConfig;
  cwd: string;
  onDirtyChange: (dirty: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    const result = await updateWorkspaceConfig({
      componentDirectory: draft.componentDirectory,
      backupRetentionDays: Number(draft.backupRetentionDays),
      maxBackups: Number(draft.maxBackups),
      autoBackup: draft.autoBackup,
      validateAfterEdit: draft.validateAfterEdit,
      port: Number(draft.port),
    });
    if (result.success) {
      setMessage(result.data?.restartRequiredReason || 'Settings saved.');
      await onRefresh();
    } else {
      setMessage(result.error?.message || 'Failed to save settings.');
    }
  }

  return (
    <section className="panel">
      <div className="settings-grid">
        <span>Project</span>
        <strong>{cwd}</strong>
        <label htmlFor="component-directory">Component directory</label>
        <input
          id="component-directory"
          onChange={(event) => setDraft({ ...draft, componentDirectory: event.target.value })}
          value={draft.componentDirectory}
        />
        <label htmlFor="studio-port">Port</label>
        <input
          id="studio-port"
          max={65535}
          min={1024}
          onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
          type="number"
          value={draft.port}
        />
        <label htmlFor="max-backups">Max backups</label>
        <input
          id="max-backups"
          max={1000}
          min={1}
          onChange={(event) => setDraft({ ...draft, maxBackups: Number(event.target.value) })}
          type="number"
          value={draft.maxBackups}
        />
        <label htmlFor="backup-retention">Backup retention</label>
        <input
          id="backup-retention"
          max={365}
          min={1}
          onChange={(event) =>
            setDraft({ ...draft, backupRetentionDays: Number(event.target.value) })
          }
          type="number"
          value={draft.backupRetentionDays}
        />
        <label>
          <input
            checked={draft.autoBackup}
            onChange={(event) => setDraft({ ...draft, autoBackup: event.target.checked })}
            type="checkbox"
          />{' '}
          Auto backup
        </label>
        <label>
          <input
            checked={draft.validateAfterEdit}
            onChange={(event) => setDraft({ ...draft, validateAfterEdit: event.target.checked })}
            type="checkbox"
          />{' '}
          Validate after edit
        </label>
      </div>
      <div className="actions">
        <button disabled={!dirty} onClick={save} type="button">
          Save settings
        </button>
        <button onClick={() => setDraft(config)} type="button">
          Reset
        </button>
      </div>
      {message ? <p>{message}</p> : null}
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
