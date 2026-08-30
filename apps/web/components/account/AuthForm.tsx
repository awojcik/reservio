"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError } from "@rezervio/api-client";

import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";

type Mode = "login" | "register" | "host-register";

const COPY = {
  login: {
    title: "Zaloguj się",
    subtitle: "Jedno konto do rezerwacji i do wystawiania obiektów.",
    submit: "Zaloguj się",
    switchText: "Nie masz jeszcze konta?",
    switchLabel: "Załóż konto",
    switchHref: "/register",
  },
  register: {
    title: "Załóż konto",
    subtitle: "Zapisuj swoje podróże w jednym miejscu. Rezerwować możesz też bez konta.",
    submit: "Załóż konto",
    switchText: "Masz już konto?",
    switchLabel: "Zaloguj się",
    switchHref: "/login",
  },
  "host-register": {
    title: "Załóż konto gospodarza",
    subtitle: "Wystaw swój obiekt i zacznij przyjmować gości.",
    submit: "Załóż konto",
    switchText: "Masz już konto?",
    switchLabel: "Zaloguj się",
    switchHref: "/host/login",
  },
} as const;

const FIELD =
  "h-12 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-ink placeholder:font-medium placeholder:text-muted/70";

export function AuthForm({
  mode,
  /** Where to land afterwards; keeps a Booking or claim flow from being lost. */
  returnTo = "/account",
}: {
  mode: Mode;
  returnTo?: string;
}) {
  const router = useRouter();
  const copy = COPY[mode];
  const isHostSignup = mode === "host-register";

  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (mode === "host-register") {
        await apiClient.registerHost({ displayName, email, password });
      } else if (mode === "register") {
        await apiClient.register({
          email,
          password,
          ...(firstName.trim() ? { firstName } : {}),
        });
      } else {
        await apiClient.login({ email, password });
      }

      router.replace(returnTo);
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught, mode));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" aria-label="rezervio — strona główna" className="mb-8">
        <Logo size={26} />
      </Link>

      <div className="w-full max-w-[420px] rounded-[14px] border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-[26px] leading-tight font-bold tracking-tightest">{copy.title}</h1>
        <p className="mt-2 text-[15px] text-muted">{copy.subtitle}</p>

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {isHostSignup ? (
            <div>
              <label htmlFor="displayName" className="mb-1.5 block text-[14px] font-bold">
                Nazwa gospodarza
              </label>
              <input
                id="displayName"
                name="displayName"
                autoComplete="name"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Anna Kowalska"
                className={FIELD}
              />
            </div>
          ) : null}

          {mode === "register" ? (
            <div>
              <label htmlFor="firstName" className="mb-1.5 block text-[14px] font-bold">
                Imię <span className="font-medium text-muted">(opcjonalnie)</span>
              </label>
              <input
                id="firstName"
                name="firstName"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="Anna"
                className={FIELD}
              />
            </div>
          ) : null}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-[14px] font-bold">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="anna@example.com"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-[14px] font-bold">
              Hasło
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "login" ? "" : "Minimum 10 znaków"}
              className={FIELD}
            />
            {mode === "login" ? null : (
              <p className="mt-1.5 text-[13px] text-muted">Minimum 10 znaków.</p>
            )}
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-[10px] border border-accent-edge/40 bg-accent/10 px-3.5 py-2.5 text-[14px] font-semibold text-ink"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Chwileczkę…" : copy.submit}
          </Button>
        </form>

        <p className="mt-6 text-center text-[14px] text-muted">
          {copy.switchText}{" "}
          <Link href={copy.switchHref} className="font-bold text-brand underline underline-offset-2">
            {copy.switchLabel}
          </Link>
        </p>
      </div>
    </main>
  );
}

function messageFor(error: unknown, mode: Mode): string {
  const signingUp = mode !== "login";
  if (!(error instanceof ApiError)) return "Coś poszło nie tak. Spróbuj ponownie.";

  if (error.status === 0) return "Nie udało się połączyć z API Rezervio.";
  if (error.status === 401) return "Nieprawidłowy email lub hasło.";
  if (error.status === 409) {
    return "Masz już konto z tym adresem email. Zaloguj się, aby dodać tę podróż.";
  }
  if (error.status === 400) {
    return signingUp
      ? "Sprawdź dane: hasło musi mieć minimum 10 znaków, a email poprawny format."
      : "Sprawdź poprawność wpisanych danych.";
  }
  return "Coś poszło nie tak. Spróbuj ponownie.";
}
