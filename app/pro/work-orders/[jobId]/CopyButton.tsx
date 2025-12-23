"use client";

import { useState } from "react";

type Props = {
  text: string;
  label: string;
};

export function CopyButton({ text, label }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
        copied
          ? "bg-green-900/30 text-green-300 border-green-700"
          : "bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600"
      }`}
      title={label}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

