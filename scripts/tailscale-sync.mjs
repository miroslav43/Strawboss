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
  // Reset everyone first so phones that dropped off the tailnet go red.
  const lines = ['UPDATE devices SET tailscale_online = false WHERE deleted_at IS NULL;'];
  for (const p of peers) {
    const host = (p.HostName ?? '').toLowerCase();
    if (!host || !p.Online) continue;
    const ip = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs[0] : null;
    const lastSeen = p.LastSeen ?? null;
    const sets = ['tailscale_online = true', 'updated_at = now()'];
    if (ip) sets.push(`tailscale_ip = ${q(ip)}`);
    sets.push(lastSeen ? `tailscale_last_seen = ${q(lastSeen)}` : 'tailscale_last_seen = now()');
    lines.push(
      `UPDATE devices SET ${sets.join(', ')} WHERE tailscale_hostname = ${q(host)} AND deleted_at IS NULL;`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
});
