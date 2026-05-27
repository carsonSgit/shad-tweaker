import type { ComponentPreviewManifest } from '@studio-shared';
import { useEffect, useRef, useState } from 'react';
import { type PreviewSelection, previewFrameUrl } from './previewState';

interface PreviewFrameProps {
  label: string;
  manifest: ComponentPreviewManifest;
  selection: PreviewSelection;
}

export function PreviewFrame({ label, manifest, selection }: PreviewFrameProps) {
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const viewport = manifest.viewports[selection.viewport];
  const frameUrl = previewFrameUrl(selection, manifest.frameUrl);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const expectedOrigin = new URL(frameUrl, window.location.href).origin;
    function handleMessage(event: MessageEvent) {
      if (event.origin !== expectedOrigin) {
        return;
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
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
  }, [frameUrl]);

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
        ref={iframeRef}
        // Keep the preview at a unique origin; all parent communication must use postMessage.
        sandbox="allow-scripts"
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
