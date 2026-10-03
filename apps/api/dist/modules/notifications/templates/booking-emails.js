"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBookingEmail = renderBookingEmail;
const NBSP = " ";
function money(amountMinor, currency) {
    const grouped = String(Math.round(amountMinor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return currency === "PLN" ? `${grouped}${NBSP}zł` : `${grouped}${NBSP}${currency}`;
}
function dates(context) {
    return `${context.checkIn} → ${context.checkOut}`;
}
function guests(context) {
    const parts = [`${context.adults} dorosłych`];
    if (context.children > 0)
        parts.push(`${context.children} dzieci`);
    return parts.join(", ");
}
function deadline(context) {
    if (!context.hostResponseDeadlineAt)
        return null;
    return new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Warsaw",
    }).format(new Date(context.hostResponseDeadlineAt));
}
function copyFor(type, context) {
    const by = deadline(context);
    switch (type) {
        case "BOOKING_REQUEST_CREATED":
            return {
                subject: `Nowa prośba o rezerwację — ${context.propertyTitle}`,
                heading: "Masz nową prośbę o rezerwację",
                lead: `${context.guestName} chce zarezerwować „${context.propertyTitle}".${by ? ` Odpowiedz do ${by}.` : ""}`,
                cta: context.hostUrl ? { label: "Zobacz prośbę", url: context.hostUrl } : undefined,
                footer: "Jeśli nie odpowiesz na czas, prośba wygaśnie automatycznie.",
            };
        case "BOOKING_REQUEST_REMINDER":
            return {
                subject: `Przypomnienie: prośba o rezerwację czeka — ${context.propertyTitle}`,
                heading: "Prośba wciąż czeka na Twoją decyzję",
                lead: by
                    ? `Masz czas do ${by}, potem prośba wygaśnie.`
                    : "Prośba wciąż czeka na Twoją decyzję.",
                cta: context.hostUrl ? { label: "Odpowiedz", url: context.hostUrl } : undefined,
            };
        case "BOOKING_REQUEST_ACCEPTED":
            return {
                subject: `Gospodarz zaakceptował rezerwację — ${context.propertyTitle}`,
                heading: "Twoja prośba została zaakceptowana",
                lead: `Gospodarz potwierdził termin w „${context.propertyTitle}". Termin jest teraz dla Ciebie zablokowany.`,
                cta: context.guestUrl
                    ? { label: "Zobacz rezerwację", url: context.guestUrl }
                    : undefined,
                footer: "Płatności jeszcze nie pobieramy.",
            };
        case "BOOKING_REQUEST_REJECTED":
            return {
                subject: `Prośba o rezerwację odrzucona — ${context.propertyTitle}`,
                heading: "Gospodarz odrzucił prośbę",
                lead: `Niestety gospodarz nie przyjął rezerwacji w „${context.propertyTitle}". Termin pozostaje wolny dla innych.`,
                cta: context.guestUrl
                    ? { label: "Zobacz szczegóły", url: context.guestUrl }
                    : undefined,
            };
        case "BOOKING_REQUEST_EXPIRED":
            return {
                subject: `Prośba o rezerwację wygasła — ${context.propertyTitle}`,
                heading: "Prośba wygasła",
                lead: `Gospodarz nie odpowiedział na czas, więc prośba o „${context.propertyTitle}" wygasła. Nic nie zostało pobrane.`,
                cta: context.guestUrl
                    ? { label: "Zobacz szczegóły", url: context.guestUrl }
                    : undefined,
            };
        case "BOOKING_CANCELLED_BY_GUEST":
            return {
                subject: `Gość anulował rezerwację — ${context.propertyTitle}`,
                heading: "Gość anulował rezerwację",
                lead: `${context.guestName} anulował(a) rezerwację w „${context.propertyTitle}". Termin wrócił do puli wolnych.`,
                cta: context.hostUrl ? { label: "Zobacz szczegóły", url: context.hostUrl } : undefined,
            };
        case "BOOKING_CANCELLED_BY_HOST":
            return {
                subject: `Gospodarz anulował rezerwację — ${context.propertyTitle}`,
                heading: "Gospodarz anulował rezerwację",
                lead: `Rezerwacja w „${context.propertyTitle}" została anulowana przez gospodarza. Nic nie zostało pobrane.`,
                cta: context.guestUrl
                    ? { label: "Zobacz szczegóły", url: context.guestUrl }
                    : undefined,
            };
        case "BOOKING_CONFIRMED":
            return {
                subject: `Rezerwacja potwierdzona — ${context.propertyTitle}`,
                heading: "Rezerwacja potwierdzona",
                lead: `Twoja rezerwacja w „${context.propertyTitle}" jest potwierdzona.`,
                cta: context.guestUrl
                    ? { label: "Zobacz rezerwację", url: context.guestUrl }
                    : undefined,
            };
        case "STAY_INSTRUCTIONS_READY":
            return {
                subject: `Szczegóły pobytu — ${context.propertyTitle}`,
                heading: "Szczegóły Twojego pobytu są gotowe",
                lead: `Zbliża się Twój pobyt w „${context.propertyTitle}"${context.checkInTime ? `. Zameldowanie od ${context.checkInTime}` : ""}. Instrukcje dojazdu, Wi-Fi i zasady domu znajdziesz w Rezervio.`,
                cta: context.guestUrl
                    ? { label: "Zobacz szczegóły pobytu", url: context.guestUrl }
                    : undefined,
            };
        case "SENSITIVE_ACCESS_READY":
            return {
                subject: `Dane dostępu — ${context.propertyTitle}`,
                heading: "Dane dostępu są już dostępne",
                lead: `Dane dostępu do obiektu „${context.propertyTitle}" są już dostępne w Rezervio.`,
                cta: context.guestUrl
                    ? { label: "Otwórz szczegóły pobytu", url: context.guestUrl }
                    : undefined,
                footer: "Ze względów bezpieczeństwa nie wysyłamy kodu w wiadomości email.",
            };
        case "STAY_CHECKOUT_REMINDER":
            return {
                subject: `Wymeldowanie jutro — ${context.propertyTitle}`,
                heading: "Zbliża się wymeldowanie",
                lead: `Wymeldowanie z „${context.propertyTitle}"${context.checkOutTime ? ` do godziny ${context.checkOutTime}` : ""}. Instrukcję wyjazdu znajdziesz w szczegółach pobytu.`,
                cta: context.guestUrl
                    ? { label: "Zobacz instrukcję wyjazdu", url: context.guestUrl }
                    : undefined,
            };
        case "BOOKING_MESSAGE_TO_HOST":
            return {
                subject: `Nowa wiadomość od gościa — ${context.propertyTitle}`,
                heading: "Nowa wiadomość od gościa",
                lead: `${context.messageAuthor ?? context.guestName} napisał(a) w sprawie rezerwacji ${context.reference}.`,
                cta: context.hostUrl
                    ? { label: "Odpowiedz w Rezervio", url: context.hostUrl }
                    : undefined,
            };
        case "BOOKING_MESSAGE_TO_GUEST":
            return {
                subject: `Nowa wiadomość od gospodarza — ${context.propertyTitle}`,
                heading: "Nowa wiadomość od gospodarza",
                lead: `Gospodarz odpowiedział w sprawie rezerwacji ${context.reference}.`,
                cta: context.guestUrl
                    ? { label: "Przeczytaj wiadomość", url: context.guestUrl }
                    : undefined,
            };
    }
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function renderBookingEmail(type, context) {
    const copy = copyFor(type, context);
    const facts = [
        ["Numer", context.reference],
        ["Obiekt", context.propertyTitle],
        ["Termin", dates(context)],
        ["Goście", guests(context)],
        ["Razem", money(context.totalAmountMinor, context.currency)],
    ];
    const text = [
        copy.heading,
        "",
        copy.lead,
        "",
        ...facts.map(([label, value]) => `${label}: ${value}`),
        ...(copy.cta ? ["", `${copy.cta.label}: ${copy.cta.url}`] : []),
        ...(copy.footer ? ["", copy.footer] : []),
        "",
        "— rezervio°",
    ].join("\n");
    const html = `<!doctype html>
<html lang="pl"><body style="margin:0;padding:24px;background:#f7f3ea;font-family:ui-sans-serif,system-ui,sans-serif;color:#101814">
  <div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #d9d5ca;border-radius:14px;padding:28px">
    <p style="margin:0 0 20px;font-size:18px;font-weight:800;letter-spacing:-0.02em">rezervio<span style="color:#ff4a32">°</span></p>
    <h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-0.02em">${escapeHtml(copy.heading)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#69716c">${escapeHtml(copy.lead)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${facts
        .map(([label, value]) => `<tr><td style="padding:6px 0;color:#69716c">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`)
        .join("")}
    </table>
    ${copy.cta
        ? `<p style="margin:24px 0 0"><a href="${escapeHtml(copy.cta.url)}" style="display:inline-block;background:#0b2f27;color:#fffdf8;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;font-size:15px">${escapeHtml(copy.cta.label)}</a></p>`
        : ""}
    ${copy.footer ? `<p style="margin:20px 0 0;font-size:13px;color:#69716c">${escapeHtml(copy.footer)}</p>` : ""}
  </div>
</body></html>`;
    return { to: "", subject: copy.subject, html, text };
}
//# sourceMappingURL=booking-emails.js.map