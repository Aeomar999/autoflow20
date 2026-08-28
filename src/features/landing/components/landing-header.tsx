import { ArrowRightIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface LandingHeaderProps {
  hasSession: boolean;
}

export const LandingHeader = ({ hasSession }: LandingHeaderProps) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <div className="relative flex size-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 shadow-xs">
            <Image
              src="/logos/autoflow-327.svg"
              alt="AutoFlow"
              width={22}
              height={22}
              className="drop-shadow-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-tight text-foreground text-lg">
              AutoFlow
            </span>
            <Badge
              variant="outline"
              className="hidden border-border/80 bg-muted/50 px-1.5 py-0 text-[10px] font-medium text-muted-foreground sm:inline-flex"
            >
              v0.4.0
            </Badge>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <a
            href="#simulator"
            className="transition-colors hover:text-foreground"
          >
            Live Simulator
          </a>
          <a
            href="#architecture"
            className="transition-colors hover:text-foreground"
          >
            Architecture
          </a>
          <a
            href="#connectors"
            className="transition-colors hover:text-foreground"
          >
            Connectors
          </a>
          <a href="#sdk" className="transition-colors hover:text-foreground">
            Node SDK
          </a>
          <a
            href="#pricing"
            className="transition-colors hover:text-foreground"
          >
            Pricing
          </a>
          <a href="#faq" className="transition-colors hover:text-foreground">
            FAQ
          </a>
        </nav>

        {/* CTAs */}
        <div className="flex items-center gap-2.5">
          {hasSession ? (
            <Button asChild size="sm" className="shadow-sm">
              <Link href="/workflows" className="flex items-center gap-1.5">
                <span>Dashboard</span>
                <ArrowRightIcon className="size-3.5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="text-muted-foreground hover:text-foreground"
              >
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm" className="shadow-sm">
                <Link href="/signup" className="flex items-center gap-1.5">
                  <span>Start Free</span>
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
