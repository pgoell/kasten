import { DrillSetup } from "@/components/finance-budget-setup";
import { DrillAccount, DrillScope } from "@/components/finance-drill-accounts";
import { DrillBooking } from "@/components/finance-drill-booking";
import type { DrillProps } from "@/components/finance-drill-parts";
import { DrillCategory, DrillPayee } from "@/components/finance-drill-spending";
import type { DrillStep } from "@/lib/finance-drill-api";

/**
 * The trail as breadcrumbs, `October 2026 › Dining › REWE`: the month leads back to the tab, and
 * each step back to itself. The last is where the reader is, so it is no button.
 */
export function Breadcrumbs({
  label,
  trail,
  onTrail,
}: {
  /** The span's name, the first step. */
  label: string;
  trail: DrillStep[];
  onTrail: (length: number) => void;
}) {
  const steps = [label, ...trail.map((step) => step.name)];
  return (
    <nav aria-label="Breadcrumbs" className="finance-crumbs">
      <ol>
        {steps.map((name, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the trail.
          <li key={index}>
            {index === steps.length - 1 ? (
              <span aria-current="page">{name}</span>
            ) : (
              <button type="button" className="finance-crumb" onClick={() => onTrail(index)}>
                {name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The view the last step of the trail opens. */
export function FinanceDrill({ step, ...props }: DrillProps & { step: DrillStep }) {
  if (step.kind === "scope") return <DrillScope scope={step.scope} {...props} />;
  if (step.kind === "account") return <DrillAccount id={step.id} {...props} />;
  if (step.kind === "category") return <DrillCategory id={step.id} {...props} />;
  if (step.kind === "payee") return <DrillPayee id={step.id} {...props} />;
  if (step.kind === "setup") return <DrillSetup {...props} />;
  return <DrillBooking id={step.id} {...props} />;
}
