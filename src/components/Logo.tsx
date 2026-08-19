import { getInitial } from "@/lib/identity";

const SIZES = {
  sm: { box: 28, radius: 8, font: 13 },
  md: { box: 32, radius: 9, font: 15 },
  lg: { box: 44, radius: 12, font: 20 },
} as const;

export function Logo({ size = "md" }: { size?: keyof typeof SIZES }) {
  const { box, radius, font } = SIZES[size];
  return (
    <div
      aria-hidden="true"
      style={{
        width: box,
        height: box,
        borderRadius: radius,
        background: "var(--brand-gradient)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: "0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.16)",
      }}
    >
      <span
        style={{
          fontSize: font,
          fontWeight: 800,
          color: "#ffffff",
          letterSpacing: "-0.02em",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {getInitial()}
      </span>
    </div>
  );
}
