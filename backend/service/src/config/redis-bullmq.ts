import type { ConnectionOptions } from 'bullmq';

/** Parse redis:// URL for BullMQ / ioredis (Docker service name or localhost). */
export function bullmqConnectionFromRedisUrl(urlStr: string): ConnectionOptions {
  const u = new URL(urlStr);
  const pathname = u.pathname?.replace(/^\//, '') ?? '';
  const opt: ConnectionOptions = {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
  };
  if (u.username) opt.username = u.username;
  if (u.password) opt.password = u.password;
  if (pathname) opt.db = parseInt(pathname, 10);
  return opt;
}
