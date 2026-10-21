"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  BriefcaseBusiness,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessagesSquare,
  Search,
  Settings,
  Users,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search", label: "Job search", icon: Search },
  { href: "/jobs", label: "Saved jobs", icon: Bookmark },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/messages", label: "Messages", icon: MessagesSquare },
  { href: "/applications", label: "Application tracker", icon: ListChecks },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <a
        href="#main-content"
        className="sr-only fixed top-3 left-3 z-50 rounded-lg bg-white px-4 py-3 font-medium shadow-lg focus:not-sr-only"
      >
        Skip to content
      </a>
      <aside
        className="border-b border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-6">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
            aria-label="RoleIntel home"
          >
            <span className="rounded-xl bg-indigo-600 p-2 text-white">
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            </span>
            <span className="text-xl font-bold tracking-tight">RoleIntel</span>
          </Link>
          <button
            ref={menuButton}
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>
        <nav
          id="primary-navigation"
          aria-label="Primary navigation"
          className={`${menuOpen ? "block" : "hidden"} px-3 pb-5 lg:block`}
        >
          <ul className="space-y-1">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href + "/") || pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                      active
                        ? "bg-indigo-50 text-indigo-800"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                    }`}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto hidden border-t border-slate-100 p-5 lg:block">
          <p className="text-sm font-semibold text-slate-700">
            Local workspace
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Single-user workspace. No account connected.
          </p>
        </div>
      </aside>
      <div className="min-w-0 lg:pl-64">
        <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
          <p className="text-sm font-medium text-slate-600">
            Your job search, thoughtfully organized.
          </p>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-7xl px-5 py-8 outline-none sm:px-8 sm:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
