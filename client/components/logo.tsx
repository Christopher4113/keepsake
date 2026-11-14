import Link from "next/link";
import { Flower2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-serif text-2xl text-foreground", className)}>
      <Flower2 className="size-5 text-primary" aria-hidden /> keepsake
    </Link>
  );
}
