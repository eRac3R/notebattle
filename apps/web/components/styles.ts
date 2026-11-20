/** Plain (non-client) style helpers, usable from server and client components. */
export type Variant = "primary" | "ghost" | "danger";

export function buttonClass(variant: Variant = "primary", extra = ""): string {
  const styles = {
    primary: "bg-brand text-ink hover:brightness-110 shadow-[0_8px_30px_-10px] shadow-brand/70",
    ghost: "bg-panel-2 text-fg hover:bg-line border border-line",
    danger: "bg-bad/15 text-bad hover:bg-bad/25 border border-bad/30",
  }[variant];
  return `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${extra}`;
}
