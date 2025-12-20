"use client";

import React, { useState } from "react";

export default function SignedTestPage() {
  const [fmKey, setFmKey] = useState("superclean");
  const [file, setFile] = useState<File | null>(null);
  const [response, setResponse] = useState<any>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert("Upload a signed PDF first.");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("fmKey", fmKey);

    const res = await fetch("/api/signed/process", {
      method: "POST",
      body: formData,
    });

    const json = await res.json();
    setResponse(json);
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Signed Work Order Test</h1>

      <form onSubmit={handleSubmit}>
        <div>
          <label>FM Key:</label>
          <input
            value={fmKey}
            onChange={(e) => setFmKey(e.target.value)}
            style={{ marginLeft: 10 }}
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <label>Upload Signed PDF:</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <button
          type="submit"
          style={{
            marginTop: 20,
            padding: "8px 16px",
            background: "#4A7",
            color: "white",
            borderRadius: 6,
          }}
        >
          Process Signed PDF
        </button>
      </form>

      {response && (
        <div style={{ marginTop: 30 }}>
          <div
            style={{
              padding: 20,
              background: "#222",
              color: "#0f0",
              borderRadius: 6,
              marginBottom: 20,
            }}
          >
            <h2 style={{ marginTop: 0, color: "#fff" }}>Response JSON</h2>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>

          {response.data && (
            <div
              style={{
                padding: 20,
                background: "#1a1a2e",
                borderRadius: 6,
                border: "1px solid #333",
              }}
            >
              <h3 style={{ marginTop: 0, color: "#fff" }}>Confidence Analysis</h3>
              <div style={{ marginTop: 10 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ color: "#fff" }}>Raw Confidence:</strong>{" "}
                  <span style={{ color: "#4af" }}>
                    {(response.data.confidenceRaw * 100).toFixed(2)}%
                  </span>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ color: "#fff" }}>Confidence Label:</strong>{" "}
                  <span
                    style={{
                      color:
                        response.data.confidenceLabel === "high"
                          ? "#4f4"
                          : response.data.confidenceLabel === "medium"
                          ? "#ff4"
                          : "#f44",
                      fontWeight: "bold",
                      textTransform: "uppercase",
                    }}
                  >
                    {response.data.confidenceLabel}
                  </span>
                </div>
                <div style={{ marginTop: 12, padding: 10, background: "#0a0a0a", borderRadius: 4 }}>
                  <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>
                    Thresholds:
                  </div>
                  <div style={{ fontSize: 11, color: "#888" }}>
                    • High: ≥ 90% (clear match - auto-update)
                    <br />
                    • Medium: ≥ 60% (somewhat reliable - auto-update)
                    <br />
                    • Low: &lt; 60% (needs manual review)
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
