// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Life, Death, and Beyond - Based on Conversations with Spirits',
  tagline: "A modern presentation of The Spirits' Book",
  favicon: 'img/favicon.ico',

  future: {
    v4: {
      fasterByDefault: false,
    },
  },

  url: 'https://javanigus.github.io',
  baseUrl: '/spirits-book/',

  organizationName: 'javanigus',
  projectName: 'spirits-book',

  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          id: 'full',
          path: 'full',
          routeBasePath: 'full',
          sidebarPath: './sidebarsFull.js',
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'simplified',
        path: 'simplified',
        routeBasePath: 'simplified',
        sidebarPath: './sidebarsSimplified.js',
        editUrl: undefined,
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'Life, Death, and Beyond - Based on Conversations with Spirits',
      logo: {
        alt: "The Spirits' Book",
        src: 'img/logo.svg',
      },
      items: [
        { to: '/', label: 'Introduction' },
        {
          type: 'docSidebar',
          sidebarId: 'fullSidebar',
          docsPluginId: 'full',
          label: 'Full Edition',
          position: 'left',
        },
        {
          type: 'docSidebar',
          sidebarId: 'simplifiedSidebar',
          docsPluginId: 'simplified',
          label: 'Simplified Edition',
          position: 'left',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} <a href="https://abdullahyahya.com/" target="_blank" rel="noopener noreferrer">Abdullah Yahya</a>`,
    },
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false, // keep toggle (recommended)
      respectPrefersColorScheme: false,
    },
  },
};

export default config;