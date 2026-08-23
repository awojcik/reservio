# Wdrożenie Rezervio na droplecie DigitalOcean

Aplikacja nie ma bazy danych, sekretów ani zmiennych środowiskowych — wdrożenie to
build + proces Node za Nginxem.

## Najpierw DNS

Domena `rezervio.pl` musi wskazywać na dropleta **zanim** ruszy certyfikat.
U operatora domeny (albo w DigitalOcean → Networking → Domains) ustaw:

| Typ | Nazwa | Wartość        |
| --- | ----- | -------------- |
| A   | `@`   | IP dropleta    |
| A   | `www` | IP dropleta    |

Propagacja to zwykle kilka–kilkadziesiąt minut. Sprawdzenie z dropleta:

```bash
getent ahostsv4 rezervio.pl | head -1
curl -s -4 https://icanhazip.com          # musi się zgadzać
```

Wdrożenie działa też bez gotowego DNS — skrypt wtedy pominie HTTPS i powie,
czym go dokończyć.

## Szybka ścieżka (konsola webowa, jako root)

Trzy krótkie polecenia — reszta dzieje się w skrypcie, więc nie ma czego wklejać:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/awojcik/reservio.git
bash reservio/deploy/setup.sh
```

Domyślną domeną jest `rezervio.pl`. Bez pytań certbota podaj e-mail:

```bash
EMAIL=ty@example.com bash reservio/deploy/setup.sh
```

Inna domena albo sam adres IP:

```bash
DOMAIN=inna.pl bash reservio/deploy/setup.sh
DOMAIN=_       bash reservio/deploy/setup.sh    # tylko po IP, bez HTTPS
```

Skrypt jest idempotentny — można go uruchomić ponownie. Instaluje Node 22, pnpm i
Nginx, dokłada 2 GB swapu przy małym RAM (bez tego `next build` pada na OOM),
konfiguruje usługę systemd oraz reverse proxy, otwiera firewall, buduje aplikację,
a na końcu — jeśli DNS już wskazuje na dropleta — wystawia certyfikat.

## HTTPS osobno

Gdy DNS nie był jeszcze gotowy przy wdrożeniu:

```bash
bash /root/reservio/deploy/tls.sh
# albo bez pytań:
EMAIL=ty@example.com bash /root/reservio/deploy/tls.sh
```

Skrypt obejmuje `rezervio.pl` i `www.rezervio.pl` (www pomija, jeśli rekord nie
istnieje), włącza przekierowanie z HTTP i sprawdza odnowienie przez `--dry-run`.
Odnowienia idą z timera systemd instalowanego razem z certbotem — cron niepotrzebny.

## Aktualizacja po zmianach

```bash
bash /root/reservio/deploy/deploy.sh
```

Pobiera zmiany, instaluje zależności, buduje, kopiuje assety i restartuje usługę.
Jeśli usługa nie wstanie, skrypt sam wypisze ostatnie logi i zwróci błąd.

## Co robią pliki w `deploy/`

| Plik               | Rola                                                          |
| ------------------ | ------------------------------------------------------------- |
| `setup.sh`         | pierwsze wdrożenie na czystym systemie                         |
| `deploy.sh`        | build + restart przy każdej kolejnej zmianie                   |
| `tls.sh`           | certyfikat Let's Encrypt dla domeny i www                      |
| `rezervio.service` | usługa systemd (`__APP_DIR__`, `__PORT__` wypełnia setup)      |
| `nginx.conf`       | reverse proxy (`__SERVER_NAME__`, `__PORT__` wypełnia setup)   |

## Ręcznie, krok po kroku

Gdyby skrypt nie pasował do sytuacji:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx git
npm i -g pnpm

git clone https://github.com/awojcik/reservio.git /root/reservio
cd /root/reservio
pnpm install --frozen-lockfile
pnpm build

# standalone nie kopiuje assetów samo — cele trzeba najpierw usunąć,
# bo `cp -r a b` przy istniejącym b zagnieżdża a wewnątrz niego
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

PORT=3000 HOSTNAME=127.0.0.1 node .next/standalone/server.js
```

Konfigurację systemd i Nginxa weź z `deploy/rezervio.service` i `deploy/nginx.conf`,
podmieniając `__APP_DIR__`, `__PORT__` i `__DOMAIN__`.

## Diagnostyka

```bash
systemctl status rezervio
journalctl -u rezervio -f
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
nginx -t && systemctl reload nginx
```

## Rzeczy specyficzne dla tej aplikacji

- **Wymagany Node ≥ 20.9** (`engines` w Next 16). Node 22 z NodeSource jest bezpieczny.
- **`output: "standalone"`** w `next.config.ts` daje serwer ~40 MB zamiast ~630 MB
  `node_modules` na hoście. Konsekwencja: na serwerze uruchamiamy
  `node .next/standalone/server.js`, nie `next start`.
- **`pnpm-workspace.yaml` musi być w repo.** Zawiera `allowBuilds`; bez niego
  `pnpm install` przerywa się błędem `ERR_PNPM_IGNORED_BUILDS`.
- **Nie kopiuj `node_modules` z komputera.** Zawiera binaria pod macOS/arm64,
  które na Linuksie x86_64 nie zadziałają — zależności instaluj na serwerze.
- **Kafelki mapy pobiera przeglądarka użytkownika**, nie serwer. Ruch wychodzący
  z dropleta jest potrzebny wyłącznie dla `next/image`, które ściąga zdjęcia
  z `images.unsplash.com`.
- **`sharp` jest opcjonalny** — optymalizacja obrazów działa bez niego. Przy
  wysokim CPU na zdjęciach: `pnpm add sharp`.
- **Uruchamianie jako root** jest najprostsze, ale docelowo lepiej założyć osobnego
  użytkownika, przenieść katalog i zmienić `User=` w `rezervio.service`.
