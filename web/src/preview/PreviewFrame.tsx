import type { ComponentPreviewManifest } from '@studio-shared';
import { useEffect, useState } from 'react';
import { type PreviewSelection, previewFrameUrl } from './previewState';

interface PreviewFrameProps {
  label: string;
  manifest: ComponentPreviewManifest;
  selection: PreviewSelection;
}

export function PreviewFrame({ label, manifest, selection }: PreviewFrameProps) {
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const viewport = manifest.viewports[selection.viewport];
  const frameUrl = previewFrameUrl(selection);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'shadcn-tweaker-preview-error'
      ) {
        setRuntimeError(event.data.message || 'Preview render failed.');
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="preview-frame-shell">
      <div className="preview-frame-header">
        <strong>{label}</strong>
        <span>
          {viewport.width} x {viewport.height}
        </span>
      </div>
      {runtimeError ? <div className="preview-diagnostic">{runtimeError}</div> : null}
      <iframe
        className="preview-frame"
        onLoad={() => setRuntimeError(null)}
        sandbox="allow-scripts allow-same-origin"
        src={frameUrl}
        style={{
          height: viewport.height,
          maxWidth: '100%',
          width: viewport.width,
        }}
        title={label}
      />
    </div>
  );
}
