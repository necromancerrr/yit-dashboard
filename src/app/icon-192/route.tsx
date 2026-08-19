import { ImageResponse } from "next/og";
import { getInitial } from "@/lib/identity";

export const dynamic = "force-static";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 40,
          background: "linear-gradient(135deg, #3987e5, #9085e9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 104,
          fontWeight: 800,
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {getInitial()}
      </div>
    ),
    { width: 192, height: 192 }
  );
}
