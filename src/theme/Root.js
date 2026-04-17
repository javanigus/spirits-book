import React, { useEffect } from 'react';
import { useLocation } from '@docusaurus/router';

export default function Root({ children }) {
  const location = useLocation();

  useEffect(() => {
    const isArabic = location.pathname.includes('/arabic/');

    document.documentElement.setAttribute('dir', isArabic ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', isArabic ? 'ar' : 'en');
    document.body.setAttribute('dir', isArabic ? 'rtl' : 'ltr');

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

    return () => {
      document.documentElement.setAttribute('dir', 'ltr');
      document.documentElement.setAttribute('lang', 'en');
      document.body.setAttribute('dir', 'ltr');
    };
  }, [location.pathname, location.hash]);

  return <>{children}</>;
}