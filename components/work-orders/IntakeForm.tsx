"use client";

import React, { useState } from "react";

interface IntakeFormProps {
  onStartProcessing: () => void;
}

export default function IntakeForm({ onStartProcessing }: IntakeFormProps) {
  const [inputMethod, setInputMethod] = useState<"email" | "upload">("email");
  const [copied, setCopied] = useState(false);

  const emailAddress = "workorders+demo@myapp.test";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(emailAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">
        Get your work orders into the app
      </h2>

      <div className="space-y-6">
        {/* Method selection */}
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Choose input method
          </label>
          
          <div className="space-y-3">
            <label className="flex items-center p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="inputMethod"
                value="email"
                checked={inputMethod === "email"}
                onChange={(e) => setInputMethod(e.target.value as "email" | "upload")}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <div className="ml-3 flex-1">
                <div className="font-medium text-gray-900">Email forwarding</div>
                <div className="text-sm text-gray-500">
                  Forward work order emails to this address
                </div>
              </div>
            </label>

            <label className="flex items-center p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="inputMethod"
                value="upload"
                checked={inputMethod === "upload"}
                onChange={(e) => setInputMethod(e.target.value as "email" | "upload")}
                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              />
              <div className="ml-3 flex-1">
                <div className="font-medium text-gray-900">Upload PDFs</div>
                <div className="text-sm text-gray-500">
                  Upload PDF work orders directly
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Email address section */}
        {inputMethod === "email" && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="text-sm font-medium text-blue-900 mb-1">
                  Forward emails to:
                </div>
                <div className="text-sm text-blue-700 font-mono">
                  {emailAddress}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {/* PDF upload section */}
        {inputMethod === "upload" && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              id="pdf-upload"
            />
            <label
              htmlFor="pdf-upload"
              className="cursor-pointer block"
            >
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                stroke="currentColor"
                fill="none"
                viewBox="0 0 48 48"
              >
                <path
                  d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="mt-4">
                <span className="text-blue-600 font-medium">Click to upload</span>
                <span className="text-gray-600"> or drag and drop</span>
              </div>
              <div className="mt-2 text-sm text-gray-500">PDF files only</div>
            </label>
          </div>
        )}

        {/* Start button */}
        <div className="pt-4">
          <button
            type="button"
            onClick={onStartProcessing}
            className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Start extraction
          </button>
        </div>
      </div>
    </div>
  );
}

