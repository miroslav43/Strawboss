export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-50 via-white to-emerald-50 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
