import { useMemo, useEffect, useRef } from 'react';
import { buildMultiFilePreviewDocument } from '../utils/designPreview.js';
import { prepareFilesForPreview } from '../utils/designPreviewFiles.js';

/** In-browser multi-file React preview — no external bundler required. */
export default function DesignSandpackPreview({ files, className = '' }) {
  const prepared = useMemo(() => prepareFilesForPreview(files), [files]);
  const html = useMemo(() => buildMultiFilePreviewDocument(prepared), [prepared]);
  const iframeRef = useRef(null);

  const hasApp = prepared['src/app/App.jsx'] || prepared['src/App.jsx'];

  useEffect(() => {
    if (html && iframeRef.current) {
      iframeRef.current.srcdoc = html;
    }
  }, [html]);

  if (!hasApp) {
    return (
      <div className={`design-sandpack-empty ${className}`}>
        <span>Preview loads when project files are ready</span>
      </div>
    );
  }

  if (!html) {
    return (
      <div className={`design-sandpack-empty ${className}`}>
        <span>Could not build preview from project files</span>
      </div>
    );
  }

  return (
    <div className={`design-sandpack-wrap visible ${className}`}>
      <iframe
        ref={iframeRef}
        className="design-preview-iframe visible"
        title="Design preview"
        sandbox="allow-scripts allow-forms"
      />
    </div>
  );
}
