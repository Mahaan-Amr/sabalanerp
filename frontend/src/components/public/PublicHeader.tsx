import Link from 'next/link';

const navItems = [
  { href: '/', label: 'خانه' },
  { href: '/about', label: 'درباره سامانه' },
  { href: '/#features', label: 'امکانات' },
  { href: '/#roadmap', label: 'مسیر توسعه' },
  { href: '/contact', label: 'تماس' },
];

export function PublicHeader() {
  return (
    <header className="public-header">
      <div className="public-container flex items-center justify-between gap-5 py-5">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="سبلان ERP">
          <span className="h-11 w-11 overflow-hidden rounded-full border border-stone-200 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-project.png" alt="" className="h-full w-full object-cover" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-extrabold text-stone-950">سبلان ERP</span>
            <span className="block text-xs font-medium text-stone-500">سامانه عملیات دیجیتال سنگ سبلان</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="ناوبری اصلی">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="public-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="public-button public-button-primary">
            ورود به سامانه
          </Link>
        </div>
      </div>
    </header>
  );
}
