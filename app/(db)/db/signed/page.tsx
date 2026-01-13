// app/(db)/db/signed/page.tsx
"use client";

import { useState, useEffect } from "react";

interface SignedDoc {
  id: string;
  extracted_work_order_number: string | null;
  extraction_method: string | null;
  extraction_confidence: string | null;
  signed_pdf_url: string | null;
  matched_work_order_id: string | null;
  matched_work_order_number: string | null;
  decision: "MATCHED" | "UNMATCHED";
  created_at: string;
}

interface SignedDocsResponse {
  items: SignedDoc[];
  nextCursor: string | null;
  hasMore: boolean;
}

export default function DbSignedDocsPage() {
  const [signedDocs, setSignedDocs] = useState<SignedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchSignedDocs = async (cursor?: string | null) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (decisionFilter) params.append("decision", decisionFilter);
      if (cursor) params.append("cursor", cursor);
      params.append("limit", "20");

      const response = await fetch(`/api/db/signed-docs?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch signed documents");
      }

      const data: SignedDocsResponse = await response.json();

      if (cursor) {
        setSignedDocs((prev) => [...prev, ...data.items]);
      } else {
        setSignedDocs(data.items);
      }

      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignedDocs();
  }, [decisionFilter]);

  const getDecisionBadge = (decision: string) => {
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-medium ${
          decision === "MATCHED"
            ? "bg-green-100 text-green-800"
            : "bg-yellow-100 text-yellow-800"
        }`}
      >
        {decision}
      </span>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Signed Documents (DB)</h1>
        <p className="text-gray-600">Database-powered signed documents view</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Decisions</option>
          <option value="MATCHED">Matched</option>
          <option value="UNMATCHED">Unmatched</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Extracted WO#
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Method
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Decision
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Matched WO#
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && signedDocs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : signedDocs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                  No signed documents found
                </td>
              </tr>
            ) : (
              signedDocs.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {doc.extracted_work_order_number || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.extraction_method || "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.extraction_confidence
                      ? `${(parseFloat(doc.extraction_confidence) * 100).toFixed(1)}%`
                      : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getDecisionBadge(doc.decision)}
                    {doc.decision === "MATCHED" && (
                      <span className="ml-2 text-xs text-green-600">✓</span>
                    )}
                    {doc.decision === "UNMATCHED" && (
                      <span className="ml-2 text-xs text-yellow-600">⚠</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {doc.matched_work_order_number ? (
                      <a
                        href={`/db/work-orders/${doc.matched_work_order_id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {doc.matched_work_order_number}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(doc.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => fetchSignedDocs(nextCursor)}
            disabled={loading}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
