import Link from "next/link";
import { BrandMark } from "@/components/Logo";
import { BRAND } from "@/branding/brand";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Assets", href: "#assets" },
      { label: "Intelligence", href: "#intelligence" },
      { label: "Security", href: "#security" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contact", href: `mailto:${BRAND.email.support}` },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/sign-in" },
      { label: "Create account", href: "/sign-up" },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="relative border-t border-gray-600 bg-gray-800">
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Link href="/">
              <BrandMark logoClassName="h-9 w-9" />
            </Link>
            <p className="mt-4 text-sm leading-6 text-gray-500">{BRAND.tagline}</p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                {col.title}
              </p>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-gray-400 transition-colors hover:text-brand-400"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-gray-600 pt-6 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {BRAND.copyrightYear} {BRAND.legalName}. All rights reserved.
          </p>
          <p className="text-gray-600">
            Informational surfaces only — not investment advice.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
