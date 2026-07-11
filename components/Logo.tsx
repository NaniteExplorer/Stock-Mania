import { cn } from "@/lib/utils";
import { BRAND } from "@/branding/brand";

/**
 * The stockMania mark — a premium violet "sM" monogram tile (CRED-style).
 * Rendered as inline SVG so it stays crisp at every size and needs no asset
 * request. Use `<Logo />` for the icon alone, `<BrandMark />` for the full
 * lockup (icon + wordmark).
 */
export const Logo = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 40 40"
    className={cn("h-9 w-9", className)}
    role="img"
    aria-label={`${BRAND.name} logo`}
  >
    <defs>
      <linearGradient id="sm-logo-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#9d90ff" />
        <stop offset="55%" stopColor="#6d5cff" />
        <stop offset="100%" stopColor="#5b50e8" />
      </linearGradient>
      <linearGradient id="sm-logo-shine" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
        <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="11" fill="url(#sm-logo-grad)" />
    <rect width="40" height="40" rx="11" fill="url(#sm-logo-shine)" />
    {/* upward "spark" tick — the markets motif */}
    <path
      d="M9 25 L16 19 L21 22 L31 13"
      fill="none"
      stroke="#ffffff"
      strokeOpacity="0.9"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="31" cy="13" r="2.1" fill="#ffffff" />
  </svg>
);

/** Full brand lockup: monogram + "stockMania" wordmark. */
export const BrandMark = ({
  className,
  logoClassName,
  wordmarkClassName,
  subtitle,
}: {
  className?: string;
  logoClassName?: string;
  wordmarkClassName?: string;
  subtitle?: string;
}) => (
  <span className={cn("flex items-center gap-2.5", className)}>
    <Logo className={logoClassName} />
    <span className="leading-none">
      <span className={cn("block text-lg font-bold tracking-tight text-gray-100", wordmarkClassName)}>
        stock<span className="text-brand-500">Mania</span>
      </span>
      {subtitle && (
        <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.18em] text-gray-500">
          {subtitle}
        </span>
      )}
    </span>
  </span>
);

export default Logo;
