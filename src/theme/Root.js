import React, { useEffect } from 'react';
import { useLocation } from '@docusaurus/router';

export default function Root({ children }) {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.substring(1);

      // Delay to allow MDX content to render
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      }, 100);
    }
  }, [location]);

  return <>{children}</>;
}