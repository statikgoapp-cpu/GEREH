import { FaInstagram, FaWhatsapp, FaYoutube } from "react-icons/fa";
import { ExternalLink, Mail, MessageCircle } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { WHATSAPP_URL } from "@/components/WhatsAppButton";

const contactLinks = [
  { label: "WhatsApp", value: "+90 536 307 25 61", href: WHATSAPP_URL, icon: FaWhatsapp, iconClassName: "text-[#25D366]", source: "contact_page" },
  { label: "E-posta", value: "statikgoapp@gmail.com", href: "mailto:statikgoapp@gmail.com", icon: Mail, iconClassName: "text-primary" },
  { label: "Instagram", value: "@gereh_app", href: "https://www.instagram.com/gereh_app/", icon: FaInstagram, iconClassName: "text-[#E4405F]" },
  { label: "YouTube", value: "@gerehapp", href: "https://www.youtube.com/@gerehapp", icon: FaYoutube, iconClassName: "text-[#FF0000]" },
];

export default function Contact() {
  return (
    <main className="bg-grid-pattern min-h-screen">
      <header className="mb-8 border-b border-border pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">GEREH</p>
        <h1 className="text-3xl font-display font-bold text-foreground">İletişim ve Destek</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Tekstil desen dijitalleştirme ve üretim platformu hakkında bize ulaşın.</p>
      </header>

      <div className="grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#25D366]/10 text-[#25D366]"><MessageCircle className="h-6 w-6" /></div>
          <h2 className="text-xl font-semibold">GEREH desteği</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Uygulama, desen işleme veya üretim akışınızla ilgili sorularınız için ekibimize ulaşabilirsiniz.</p>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("WHATSAPP_CLICK", undefined, { source: "contact_page" })}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#20bd5a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/30"
          >
            <FaWhatsapp className="h-5 w-5" aria-hidden="true" />
            WhatsApp'tan yazın
          </a>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {contactLinks.map(({ label, value, href, icon: Icon, iconClassName, source }) => (
            <a
              key={label}
              href={href}
              target={href.startsWith("mailto:") ? undefined : "_blank"}
              rel={href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
              onClick={source ? () => trackEvent("WHATSAPP_CLICK", undefined, { source }) : undefined}
              className="group flex min-h-[132px] flex-col justify-between rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between"><Icon className={`h-6 w-6 ${iconClassName}`} aria-hidden="true" /><ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" /></div>
              <div><p className="text-sm font-semibold">{label}</p><p className="mt-1 break-all text-sm text-muted-foreground">{value}</p></div>
            </a>
          ))}
        </section>
      </div>
    </main>
  );
}