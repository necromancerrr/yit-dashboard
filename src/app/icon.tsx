import { ImageResponse } from "next/og";
import { getInitial } from "@/lib/identity";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          background: "linear-gradient(135deg, #3987e5, #9085e9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 800,
          color: "#ffffff",
        }}
      >
        {getInitial()}
      </div>
    ),
    { ...size }
  );
}
