import {useEffect} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function Home() {
  const {siteConfig} = useDocusaurusContext();

  useEffect(() => {
    window.location.replace(`${siteConfig.baseUrl}docs/intro`);
  }, [siteConfig.baseUrl]);

  return null;
}