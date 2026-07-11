import { BrandMark } from "@/components/Logo";

/**
 * Full-screen state shown when core infrastructure (the database) is
 * unreachable. Rendered by the app shell instead of bouncing users to
 * sign-in during an outage.
 */
const ServiceUnavailable = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
    <BrandMark />
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-gray-100">
        We&apos;ll be right back
      </h1>
      <p className="mx-auto max-w-sm text-sm text-gray-500">
        We can&apos;t reach our servers right now. Your data is safe — please
        try again in a moment.
      </p>
    </div>
    <a
      href=""
      className="rounded-full border border-gray-600 px-5 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700/50"
    >
      Retry
    </a>
  </div>
);

export default ServiceUnavailable;
