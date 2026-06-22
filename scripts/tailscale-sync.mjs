// Reads `tailscale status --json` on stdin and emits SQL that syncs each fleet phone's
// tailscale_online / tailscale_ip / tailscale_last_seen by matching the Tailscale peer
// HostName to devices.tailscale_hostname. Piped to psql by `strawboss.sh fleet:tailscale-sync`.
// (The backend container can't reach the tailnet, so this runs on the host.)

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const peers = Object.values(s.Peer ?? s.Peers ?? {});
  const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
  // A peer counts as online if Tailscale reports it Online, OR it was seen within a grace
  // window — so a brief Doze/network blip doesn't flip the dot to red on a phone that's
  // really fine. Only a genuine outage (no battery/internet for > GRACE) shows offline.
  const GRACE_MS = 5 * 60 * 1000;
  const now = Date.now();
  // Reset everyone first so phones that genuinely dropped off the tailnet go red.
  const lines = ['UPDATE devices SET tailscale_online = false WHERE deleted_at IS NULL;'];
  for (const p of peers) {
    const host = (p.HostName ?? '').toLowerCase();
    if (!host) continue;
    // A currently-connected peer reports LastSeen as the zero value (year 0001) — treat that
    // (and anything pre-2000) as "no real last-seen".
    const lastSeenMs = p.LastSeen ? Date.parse(p.LastSeen) : NaN;
    const hasRealLastSeen = Number.isFinite(lastSeenMs) && new Date(lastSeenMs).getUTCFullYear() > 2000;
    const isOnline = p.Online === true || (hasRealLastSeen && now - lastSeenMs < GRACE_MS);
    if (!isOnline) continue;
    const ip = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs[0] : null;
    const sets = ['tailscale_online = true', 'updated_at = now()'];
    if (ip) sets.push(`tailscale_ip = ${q(ip)}`);
    // Real last-seen if we have one; otherwise it's online now → now().
    sets.push(hasRealLastSeen ? `tailscale_last_seen = ${q(p.LastSeen)}` : 'tailscale_last_seen = now()');
    lines.push(
      `UPDATE devices SET ${sets.join(', ')} WHERE tailscale_hostname = ${q(host)} AND deleted_at IS NULL;`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
});
