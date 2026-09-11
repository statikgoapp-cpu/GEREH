import { FaWhatsapp } from "react-icons/fa";
import { trackEvent } from "@/lib/analytics";

export const WHATSAPP_MESSAGE = "Merhaba, GEREH hakkında bilgi almak istiyorum.";
export const WHATSAPP_URL = `https://wa.me/905363072561?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

interface WhatsAppButtonProps {
  source?: string;
  className?: string;
}

export function WhatsAppButton({ source = "floating_button", className }: WhatsAppButtonProps) {
  const handleClick = () => {
    trackEvent("WHATSAPP_CLICK", undefined, { source });
  };

  return (
    <div className={`group fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6 ${className ?? ""}`}>
      <span className="pointer-events-none absolute bottom-full right-0 mb-3 hidden w-max max-w-[min(260px,calc(100vw-2rem))] rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-card-foreground shadow-lg sm:block sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        WhatsApp'tan bize ulaşın
      </span>
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        aria-label="GEREH WhatsApp desteğine ulaşın"
        title="WhatsApp destek"
        className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/30 transition-transform hover:scale-105 hover:bg-[#20bd5a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/40 sm:h-14 sm:w-14"
      >
        <FaWhatsapp className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
      </a>
    </div>
  );
}