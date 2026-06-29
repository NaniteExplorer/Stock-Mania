export default function WorkspaceLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" role="status" aria-label="Loading financial workspace">
      <div className="h-9 w-56 rounded-lg bg-gray-700/60" />
      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="h-72 rounded-2xl border border-gray-600 bg-gray-800" />
        <div className="h-72 rounded-2xl border border-gray-600 bg-gray-800" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 rounded-2xl border border-gray-600 bg-gray-800" />)}
      </div>
      <span className="sr-only">Loadingâ€¦</span>
    </div>
  );
}
