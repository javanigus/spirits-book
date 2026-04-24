// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Life, Death, and Beyond - Based on Conversations with Spirits',
  tagline: "A modern presentation of The Spirits' Book",
  favicon: 'img/favicon.ico',
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic&display=swap',
    'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu&display=swap',
  ],

  future: {
    v4: {
      fasterByDefault: false,
    },
  },

  url: 'https://lifedeathbeyondbook.com',
  baseUrl: '/',

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
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'arabic',
        path: 'arabic',
        routeBasePath: 'arabic',
        sidebarPath: require.resolve('./sidebarsSimplified.js'),
        editUrl: undefined,
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'spanish',
        path: 'spanish',
        routeBasePath: 'spanish',
        sidebarPath: require.resolve('./sidebarsSimplified.js'),
        editUrl: undefined,
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'urdu',
        path: 'urdu',
        routeBasePath: 'urdu',
        sidebarPath: require.resolve('./sidebarsSimplified.js'),
        editUrl: undefined,
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'story',
        path: 'story',
        routeBasePath: 'story',
        sidebarPath: require.resolve('./sidebarsStory.js'),
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
          label: 'Doctrine',
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
            {
              label: 'Español',
              to: '/spanish/part-1/chapter-01',
            },
            {
              label: 'اردو',
              to: '/urdu/part-1/chapter-01',
            },
          ],
        },
        {
          label: 'Story',
          to: '/story/prologue',
          position: 'right',
        },
        {
          label: 'Videos',
          to: '/videos',
          position: 'right',
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
