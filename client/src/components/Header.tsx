/* Federal Modernism Design: Clean navigation with systematic hierarchy */

import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { NotificationBell } from "./NotificationBell";
import { useAuth } from "@/_core/hooks/useAuth";
import NavigationMenu from "./NavigationMenu";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isAuthenticated, user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "editor";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2">
          <img 
            src="/images/rapidapplications-logo.webp" 
            alt="RapidApplications" 
            className="h-10 w-auto"
          />
        </Link>

        {/* Desktop Navigation - Dynamic Menu (falls back to defaults when no CMS menu exists) */}
        <NavigationMenu
          location="header"
          className="hidden md:flex"
          fallbackItems={[
            { label: "Solutions", url: "/solutions" },
            { label: "Features", url: "/features" },
            { label: "Use Cases", url: "/use-cases" },
            { label: "About", url: "/about" },
            { label: "Partners", url: "/partners" },
            { label: "Government", url: "/government-services" },
            { label: "Blog", url: "/blog" },
          ]}
        />

        {/* CTA Buttons */}
        <div className="hidden md:flex md:items-center md:space-x-4">
          {isAdmin && <NotificationBell />}
          <Button variant="outline" asChild>
            <Link href="/contact/expert">Talk to an Expert</Link>
          </Button>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" asChild>
            <Link href="/contact/demo">Book a Demo</Link>
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="container py-4 space-y-4">
            <Link 
              href="/solutions" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Solutions
            </Link>
            <Link 
              href="/features" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Features
            </Link>
            <Link 
              href="/use-cases" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Use Cases
            </Link>
            <Link 
              href="/about" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              About
            </Link>
            <Link 
              href="/partners" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Partners
            </Link>
            <Link 
              href="/government-services" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Government
            </Link>
            <Link 
              href="/blog" 
              className="block py-2 text-sm font-medium text-foreground hover:text-primary"
              onClick={() => setMobileMenuOpen(false)}
            >
              Blog
            </Link>
            <div className="pt-4 space-y-2">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/contact/expert" onClick={() => setMobileMenuOpen(false)}>Talk to an Expert</Link>
              </Button>
              <Button className="w-full bg-accent hover:bg-accent/90 text-accent-foreground" asChild>
                <Link href="/contact/demo" onClick={() => setMobileMenuOpen(false)}>Book a Demo</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
