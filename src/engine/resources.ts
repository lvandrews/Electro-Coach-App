// Resources: grouped links to outside sites, editable in the app. The built-in list
// is the starter set; once edited, the edited list is stored (settings key `resources`).

export interface ResourceLink { id: string; name: string; url: string; note?: string }
export interface ResourceGroup { id: string; title: string; links: ResourceLink[] }

export const STARTER_RESOURCES: ResourceGroup[] = [
  { id: 'training', title: 'Training tools', links: [
    { id: 'railbird', name: 'Railbird', url: 'https://railbird.ai/' },
    { id: 'poolbilliards', name: 'Poolbilliards', url: 'https://www.poolbilliards.co/' },
  ] },
  { id: 'channels', title: 'Instructional channels', links: [
    { id: 'sharivari', name: 'Sharivari', url: 'https://www.youtube.com/@Sharivari' },
    { id: 'mrcueball', name: 'Mr. Cueball', url: 'https://www.youtube.com/@MrCueBall' },
    { id: 'ouschan', name: 'Jasmin Ouschan', url: 'https://www.youtube.com/@jasminouschanbilliards' },
    { id: 'feijen', name: 'Niels Feijen', url: 'https://www.youtube.com/@NielsTheTerminatorFeijen' },
    { id: 'fefilova', name: 'Margaret Fefilova Styer', url: 'https://www.youtube.com/@margaretfefilova' },
  ] },
  { id: 'rating', title: 'Rating system', links: [
    { id: 'fargorate', name: 'FargoRate', url: 'https://fargorate.com/' },
  ] },
  { id: 'matches', title: 'Play matches', links: [
    { id: 'salotto', name: 'Salotto', url: 'https://salotto.app/' },
  ] },
];

export const newResourceId = () => Math.random().toString(36).slice(2, 9);

/** Accept "example.com/x" as https://example.com/x; reject anything that isn't a web address. */
export function normalizeUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
