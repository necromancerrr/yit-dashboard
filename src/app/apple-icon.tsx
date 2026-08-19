import { ImageResponse } from "next/og";
import { getInitial } from "@/lib/identity";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #3987e5, #9085e9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 96,
          fontWeight: 800,
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {getInitial()}
      </div>
    ),
    { ...size }
  );
}
