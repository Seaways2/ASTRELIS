import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Shared icon and label layout for player settings and tool sections. */
export function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return <h3 className="section-heading"><Icon aria-hidden="true" /><span>{children}</span></h3>;
}
