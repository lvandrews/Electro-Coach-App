// How Railbird fits with Electro-Coach: a companion, not a chore. Shown on Import, in the
// session settings and on About, so nobody thinks they need to film everything.

export const RAILBIRD_ROLE = [
  { head: 'Film free play or playing the ghost.', text: 'Real games give the widest mix of shots, the ones you actually face, so that’s where the most useful data comes from.' },
  { head: 'Film a drill now and then to fill gaps.', text: 'Most players steer around shots they don’t like. A short filmed drill makes sure those shots show up in your data too.' },
  { head: 'You don’t need to film every time.', text: 'One or two 20–30 minute recordings a week is plenty. The rest of practice is tapped on the phone, or not recorded at all.' },
  { head: 'Electro-Coach does the rest.', text: 'It turns what Railbird recorded into a plan aimed at the shots that cost you the most, builds it into steady practice habits, and shows whether it’s working.' },
];

export function RailbirdRole({ open = false, bare = false, title = 'How Railbird fits: a companion, not a chore' }: { open?: boolean; bare?: boolean; title?: string }) {
  return (
    <details class={`${bare ? '' : 'card '}railbird-role`} open={open}>
      <summary><b>{title}</b></summary>
      <ul class="usage-list small" style={{ marginBottom: 0 }}>
        {RAILBIRD_ROLE.map(r => <li key={r.head}><b>{r.head}</b> {r.text}</li>)}
      </ul>
    </details>
  );
}
