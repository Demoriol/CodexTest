# Gaduly (Discord-like, self-hosted)

> ⚠️ To jest **MVP Discord-like**: układ i funkcje są inspirowane Discordem, ale to nie jest 1:1 klon produkcyjny Discorda.

## Co działa

- Układ podobny do Discorda:
  - lewa kolumna: serwery,
  - środkowa lewa: kanały tekstowe + głosowe,
  - środek: czat,
  - prawa: ustawienia użytkownika.
- Kanały tekstowe:
  - wysyłanie wiadomości,
  - wysyłanie obrazków,
  - emoji (tekstowo),
  - edycja i usuwanie własnych wiadomości.
- Kanały głosowe (konfiguracja):
  - zmiana nazwy,
  - limit osób,
  - bitrate kbps,
  - hasło.
- Rozmowa głosowa:
  - przełączniki stanu: wyciszenie mikrofonu oraz mikrofon + głośniki (sygnalizacja w systemie).
- Ustawienia użytkownika:
  - avatar,
  - nick,
  - źródło dźwięku,
  - źródło mikrofonu,
  - czułość mikrofonu,
  - automatic voice gain,
  - głośność głośników i mikrofonu.
- Trwałość danych:
  - wiadomości zapisują się w SQLite na wolumenie Dockera,
  - codzienny backup o `03:00` do `/data/backups` (retencja 30 dni).
- Rejestracja i logowanie użytkowników.
- Szablon 5 użytkowników: `app/users.template.json`.
- Role i uprawnienia (zestaw bazowy zbliżony do Discorda; konfigurowane przez API).

---

## Struktura

- `app/server.js` – API, auth, Socket.IO, SQLite.
- `app/public/*` – frontend.
- `app/users.template.json` – 5 gotowych userów do seedowania.
- `app/scripts/seedUsers.js` – seed użytkowników z template.
- `app/scripts/backup.sh` – backup DB.
- `docker-compose.yml` – app + cron backup.

---

## Wdrożenie na Debian (Raspberry Pi)

### 1) Instalacja Dockera + Compose plugin

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
```

### 2) Przygotowanie projektu

```bash
git clone <twoj_repo_z_tym_projektem> gaduly
cd gaduly
cp .env.example .env
```

W `.env` ustaw silny `JWT_SECRET`.

### 3) Start aplikacji

```bash
docker compose up -d --build
```

### 4) Seed 5 użytkowników z szablonu

```bash
docker compose exec gaduly node scripts/seedUsers.js
```

### 5) Konfiguracja DNS w Cloudflare

- Rekord `A`:
  - `Name`: `gaduly`
  - `IPv4`: `123.456.789.012`
- Na routerze przekieruj:
  - `80 -> serwer Debian`
  - `443 -> serwer Debian`

### 6) Reverse proxy (Nginx) + TLS Let's Encrypt

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Plik:

`/etc/nginx/sites-available/gaduly.mojhost.pl`

```nginx
server {
    listen 80;
    server_name gaduly.mojhost.pl;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktywacja i certyfikat:

```bash
sudo ln -s /etc/nginx/sites-available/gaduly.mojhost.pl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d gaduly.mojhost.pl
```

### 7) Aktualizacje

```bash
git pull
docker compose up -d --build
```

### 8) Sprawdzenie backupu

```bash
docker compose logs backup --tail=100
docker compose exec gaduly ls -lah /data/backups
```

---

## Uwaga o głosie (WebRTC)

Aktualnie projekt zawiera warstwę kanałów głosowych i kontrolki mute/deafen + konfigurację kanału.
Jeżeli chcesz **pełne voice chat real-time jak Discord**, kolejnym krokiem jest dołożenie WebRTC (SFU, np. LiveKit/Janus/mediasoup) i integracja w UI.
