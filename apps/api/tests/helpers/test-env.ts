/**
 * Konfiguracja, którą testy muszą mieć własną — nie z `.env` autora.
 *
 * Trzy szyfry (iCal, dane dostępu do obiektu, dane dostawców) sprawdzają swój
 * klucz w `onModuleInit`, więc bez niego `AppModule` nie wstaje wcale. Wszystkie
 * spadają do `ICAL_URL_ENCRYPTION_KEY`, dlatego wystarczy ustawić ten jeden.
 *
 * Przypisanie jest **bezwarunkowe**. Gdyby respektowało to, co już jest
 * w środowisku, wynik testu zależałby od zawartości `.env` na maszynie, która
 * go uruchomiła: przechodziłby lokalnie i przewracał się w CI, gdzie żadnego
 * `.env` nie ma. Dokładnie to się stało, kiedy CI ruszyło po raz pierwszy.
 *
 * Wywołaj to **przed** zbudowaniem modułu — `ConfigModule` czyta środowisko
 * przy kompilacji, nie przy każdym odczycie.
 */
export function applyTestEnv(): void {
  process.env.DATABASE_URL ??= "postgresql://rezervio:rezervio@localhost:5432/rezervio";
  process.env.REDIS_URL ??= "redis://localhost:6379";

  // Deterministyczny, żeby szyfrogram z jednego przebiegu dał się odczytać
  // w następnym. To nie jest sekret i nigdy nie był.
  process.env.ICAL_URL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}
