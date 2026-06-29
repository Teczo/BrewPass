"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";

import { cn } from "@/lib/cn";

type Tab = {
  href: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement;
  /** Active when the path equals href, or (when true) starts with href. */
  matchPrefix?: boolean;
};

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7} {...props}>
      <path d="M4 10l8-6 8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

function MonthlyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

function VendorsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} {...props}>
      <path d="M3 9l1.5-5h15L21 9M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18" />
    </svg>
  );
}

function ProfileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

const TABS: Tab[] = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  {
    href: "/dashboard/monthly",
    label: "Monthly",
    Icon: MonthlyIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/vendor",
    label: "Vendors",
    Icon: VendorsIcon,
    matchPrefix: true,
  },
  {
    href: "/dashboard/profile",
    label: "Profile",
    Icon: ProfileIcon,
    matchPrefix: true,
  },
];

function isActive(pathname: string, tab: Tab): boolean {
  return tab.matchPrefix ? pathname.startsWith(tab.href) : pathname === tab.href;
}

/**
 * Fixed bottom tab bar for the subscriber app shell (Phase N.1).
 * Active tab → sage; inactive → muted taupe. Centered to the shell width.
 */
export function BottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-md items-start justify-between px-7 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3.5">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1.5",
                active ? "text-sage" : "text-nav-muted",
              )}
            >
              <tab.Icon width={25} height={25} stroke="currentColor" />
              <span
                className={cn(
                  "text-[11px]",
                  active ? "font-semibold" : "font-medium",
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
