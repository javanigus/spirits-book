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
        sidebarPath: require.resolve('./sidebarsSimplified.js'),
        editUrl: undefined,
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'indonesian',
        path: 'indonesian',
        routeBasePath: 'indonesian',
        sidebarPath: require.resolve('./sidebarsSimplified.js'),
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
        { to: '/', 
          label: 'Introduction', 
          position: 'right',
          exact: true 
        },
        {
          label: 'Languages',
          position: 'right',
          items: [
            {
              label: 'English',
              to: '/simplified/part-1/chapter-01',
            },
            {
              label: 'Bahasa Indonesia',
              to: '/indonesian/part-1/chapter-01',
            },
            {
              label: 'العربية',
              to: '/arabic/part-1/chapter-01',
            },
          ],
        }
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