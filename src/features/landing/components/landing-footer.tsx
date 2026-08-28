import { ArrowUpRightIcon, ShieldCheckIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const LandingFooter = () => {
  return (
    <footer className="border-t border-border/60 bg-card py-12 text-xs text-muted-foreground">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12 lg:gap-12">
          {/* Brand & Status Column */}
          <div className="flex flex-col gap-4 md:col-span-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                <Image
                  src="/logos/autoflow-327.svg"
                  alt="AutoFlow"
                  width={20}
                  height={20}
                />
              </div>
              <span className="font-bold text-sm text-foreground">
                AutoFlow
              </span>
            </Link>

            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              AI-native visual automation with durable step execution, zero-leak
              credential isolation, and observable node traces.
            </p>

            {/* Live Operational Status */}
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground w-fit">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>All Systems Operational</span>
              <span className="text-border">·</span>
              <span>v0.4.0</span>
            </div>
          </div>

          {/* Links Columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-8">
            {/* Column 1: Product */}
            <div className="flex flex-col gap-3">
              <h4 className="font-semibold text-xs text-foreground tracking-wide uppercase">
                Product
              </h4>
              <ul className="flex flex-col gap-2">
                <li>
                  <Link
                    href="/workflows"
                    className="hover:text-foreground transition-colors"
                  >
                    Visual Canvas Editor
                  </Link>
                </li>
                <li>
                  <Link
                    href="/executions"
                    className="hover:text-foreground transition-colors"
                  >
                    Execution Traces
                  </Link>
                </li>
                <li>
                  <Link
                    href="/credentials"
                    className="hover:text-foreground transition-colors"
                  >
                    Encrypted Vault
                  </Link>
                </li>
                <li>
                  <a
                    href="#simulator"
                    className="hover:text-foreground transition-colors"
                  >
                    Live Simulator
                  </a>
                </li>
                <li>
                  <a
                    href="#pricing"
                    className="hover:text-foreground transition-colors"
                  >
                    Pricing & Plans
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 2: Architecture & Developers */}
            <div className="flex flex-col gap-3">
              <h4 className="font-semibold text-xs text-foreground tracking-wide uppercase">
                Engineering
              </h4>
              <ul className="flex flex-col gap-2">
                <li>
                  <a
                    href="#architecture"
                    className="hover:text-foreground transition-colors"
                  >
                    Durable DAG Engine
                  </a>
                </li>
                <li>
                  <a
                    href="#connectors"
                    className="hover:text-foreground transition-colors"
                  >
                    Node Catalogue
                  </a>
                </li>
                <li>
                  <a
                    href="#sdk"
                    className="hover:text-foreground transition-colors"
                  >
                    Isomorphic Node SDK
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <span>GitHub Repository</span>
                    <ArrowUpRightIcon className="size-3" />
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Security & Trust */}
            <div className="flex flex-col gap-3">
              <h4 className="font-semibold text-xs text-foreground tracking-wide uppercase">
                Security
              </h4>
              <ul className="flex flex-col gap-2">
                <li>
                  <span className="flex items-center gap-1.5">
                    <ShieldCheckIcon className="size-3.5 text-emerald-500" />
                    <span>AES-256-GCM DEK</span>
                  </span>
                </li>
                <li>
                  <span className="hover:text-foreground transition-colors">
                    Zero Plaintext Read Path
                  </span>
                </li>
                <li>
                  <span className="hover:text-foreground transition-colors">
                    HMAC Webhook Auth
                  </span>
                </li>
                <li>
                  <span className="hover:text-foreground transition-colors">
                    Tenant Data Isolation
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-6 sm:flex-row text-[11px]">
          <p>© {new Date().getFullYear()} AutoFlow. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="hover:text-foreground transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="hover:text-foreground transition-colors"
            >
              Create Account
            </Link>
            <a href="#faq" className="hover:text-foreground transition-colors">
              FAQ
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
