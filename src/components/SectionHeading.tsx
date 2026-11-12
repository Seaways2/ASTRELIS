import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Hint } from "./Hint";

/** Shared icon and label layout for player settings and tool sections. */
export function SectionHeading({ icon: Icon, children, hint }: { icon: LucideIcon; children: ReactNode; hint?: ReactNode }) {
  return <h3 className="section-heading"><Icon aria-hidden="true" /><span>{children}</span>{hint && <Hint>{hint}</Hint>}</h3>;
}
