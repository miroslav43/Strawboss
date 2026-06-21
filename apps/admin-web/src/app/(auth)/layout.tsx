export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // Full-bleed — the login page owns the split-premium layout (brand panel + form).
  return <div className="min-h-screen bg-cream">{children}</div>;
}
