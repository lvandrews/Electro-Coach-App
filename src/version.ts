// The release this copy of the app was built as: 0.1.N for the Android app (set by the
// GitHub build), "web" for the web and single-file versions.
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const REPO = 'lvandrews/Electro-Coach-App';
export const REPO_URL = `https://github.com/${REPO}`;
