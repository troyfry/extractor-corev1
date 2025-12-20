// lib/bunny-snippets.ts
import { randomUUID } from "crypto";

export type UploadSnippetArgs = {
  dataUrl: string;
  fmKey: string | null;
  woNumber: string | null;
};

export async function uploadSnippetToBunny({
  dataUrl,
  fmKey,
  woNumber,
}: UploadSnippetArgs): Promise<string | null> {
  const {
    BUNNY_STORAGE_API_KEY,
    BUNNY_STORAGE_ZONE,
    BUNNY_PUBLIC_BASE_URL,
  } = process.env;

  if (!BUNNY_STORAGE_API_KEY || !BUNNY_STORAGE_ZONE || !BUNNY_PUBLIC_BASE_URL) {
    console.warn(
      "[Bunny] Missing env vars, skipping snippet upload. " +
        "Need BUNNY_STORAGE_API_KEY, BUNNY_STORAGE_ZONE, BUNNY_PUBLIC_BASE_URL"
    );
    return null;
  }

  if (!dataUrl.startsWith("data:image/")) {
    console.warn("[Bunny] uploadSnippetToBunny called without data:image URL");
    return null;
  }

  const [, base64Part] = dataUrl.split(",", 2);
  if (!base64Part) return null;

  const buffer = Buffer.from(base64Part, "base64");

  const safeFm = fmKey || "unknown";
  const safeWo = woNumber || randomUUID();
  const objectPath = `signed-snippets/${safeFm}/${safeWo}.png`;

  const storageUrl = `https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/${objectPath}`;

  console.log("[Bunny] Uploading snippet:", {
    zone: BUNNY_STORAGE_ZONE,
    path: objectPath,
    hasApiKey: !!BUNNY_STORAGE_API_KEY,
    apiKeyLength: BUNNY_STORAGE_API_KEY?.length,
  });

  // Try AccessKey header first (Storage Zone Password)
  // If that fails, the user may need to use their Storage Zone Password instead of API key
  const res = await fetch(storageUrl, {
    method: "PUT",
    headers: {
      AccessKey: BUNNY_STORAGE_API_KEY,
      "Content-Type": "image/png",
    },
    body: buffer,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[Bunny] Failed to upload snippet:", {
      status: res.status,
      statusText: res.statusText,
      error: errorText,
    });
    
    if (res.status === 401) {
      console.error(
        "[Bunny] Authentication failed. Make sure BUNNY_STORAGE_API_KEY is set to your Storage Zone Password, " +
        "not your account API key. You can find the Storage Zone Password in your Bunny dashboard under Storage > Your Zone > FTP & HTTP API."
      );
    }
    
    return null;
  }

  const publicBase = BUNNY_PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${publicBase}/${objectPath}`;
}
