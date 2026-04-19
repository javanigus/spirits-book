import React, { useEffect, useMemo, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function SectionImage({ src, alt, maxWidth = 720 }) {
  const [open, setOpen] = useState(false);
  const resolvedSrc = useBaseUrl(src);

  const inlineStyle = useMemo(
    () => ({
      display: 'block',
      width: '100%',
      maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
      borderRadius: '8px',
      cursor: 'zoom-in',
    }),
    [maxWidth],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <img src={resolvedSrc} alt={alt} loading="lazy" style={inlineStyle} onClick={() => setOpen(true)} />
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Expanded image'}
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            cursor: 'zoom-out',
          }}>
          <button
            type="button"
            aria-label="Close image"
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              top: '1rem',
              right: '1rem',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.12)',
              color: '#fff',
              borderRadius: '6px',
              padding: '0.45rem 0.7rem',
              cursor: 'pointer',
              fontSize: '1rem',
              lineHeight: 1,
            }}>
            ✕
          </button>

          <img
            src={resolvedSrc}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
            style={{
              maxWidth: 'min(96vw, 1600px)',
              maxHeight: '92vh',
              width: 'auto',
              height: 'auto',
              borderRadius: '10px',
              boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
              cursor: 'default',
            }}
          />
        </div>
      )}
    </>
  );
}
