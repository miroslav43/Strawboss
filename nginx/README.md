# Nginx (StrawBoss Docker)

Configurația activă este **`conf.d/*.conf`** — câte un fișier per domeniu / proiect (prefix numeric optional: `10-`, `20-`, …).

## Certificat Let's Encrypt (primă configurare)

1. Pornește nginx pe 80: `./strawboss.sh docker:up nginx` (sau echivalent).
2. Emite certificatul: `./strawboss.sh ssl:init`
3. Pornește stack-ul complet: `./strawboss.sh docker:up`

Log-urile nginx la consolă pentru `docker compose logs nginx`; certificatele stau în volumul Docker `letsencrypt`.

### Certificat pentru alt domeniu (ex. infomeditatii.ro)

După ce în `conf.d` există vhost pe port 80 cu `location /.well-known/acme-challenge/`:

```bash
cd /path/to/Strawboss
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d exemplu.ro -d www.exemplu.ro \
  --agree-tos --no-eff-email --non-interactive \
  --register-unsafely-without-email
docker compose exec nginx nginx -s reload
```

Apoi activează `listen 443 ssl` în fișierul conf al site-ului.

## Site nou

1. Copiază `conf.d/_template.conf.example` → `conf.d/40-nume-domeniu.conf`.
2. În container: `docker compose exec nginx nginx -t` apoi `nginx -s reload` sau `docker compose up -d nginx`.

## Fișier vechi

`nginx.conf.legacy` este monolitul anterior (înainte de split). Nu îl folosi în docker-compose — doar referință.
