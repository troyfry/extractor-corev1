"use client";

import { useMemo, useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";

// Component to handle snippet image with proper React state management
function SnippetImageCell({ signedPreviewImageUrl, woNumber }: { signedPreviewImageUrl: string | null; woNumber: string }) {
  const [imageError, setImageError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!signedPreviewImageUrl) {
      setCurrentSrc(null);
      setImageError(false);
      return;
    }

    // Convert Google Drive view link to direct image link
    let directImageUrl = signedPreviewImageUrl;
    
    // Handle Google Drive URLs - convert to direct image link
    if (signedPreviewImageUrl.includes("drive.google.com")) {
      // Try to extract file ID from various Google Drive URL formats
      const fileIdMatch = signedPreviewImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                        signedPreviewImageUrl.match(/id=([a-zA-Z0-9_-]+)/) ||
                        signedPreviewImageUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      
      if (fileIdMatch) {
        const fileId = fileIdMatch[1];
        // Use the thumbnail format which is more reliable for public images
        directImageUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
      }
    }
    
    // Handle base64 data URLs
    if (signedPreviewImageUrl.startsWith("data:image")) {
      directImageUrl = signedPreviewImageUrl;
    }
    
    setCurrentSrc(directImageUrl);
    setImageError(false);
  }, [signedPreviewImageUrl]);

  if (!signedPreviewImageUrl) {
    return <span className="text-gray-500">-</span>;
  }

  if (imageError) {
    return <span className="text-gray-500 text-xs">Image unavailable</span>;
  }

  return (
    <a
      href={signedPreviewImageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block"
    >
      <img
        src={currentSrc || signedPreviewImageUrl}
        alt={`WO ${woNumber} preview`}
        className="h-6 w-auto border border-gray-600 rounded max-w-[50px] object-contain"
        onError={(e) => {
          console.error("Failed to load snippet image:", {
            original: signedPreviewImageUrl,
            current: currentSrc,
            woNumber: woNumber,
          });
          
          // Try fallback: use original URL if we tried a converted URL
          if (currentSrc && currentSrc !== signedPreviewImageUrl && e.currentTarget.src === currentSrc) {
            e.currentTarget.src = signedPreviewImageUrl;
            return;
          }
          
          // If both failed, mark as error (React will re-render)
          setImageError(true);
        }}
        onLoad={() => {
          // Only log in development to reduce console noise
          if (process.env.NODE_ENV === "development") {
            console.log("Successfully loaded snippet image:", {
              woNumber: woNumber,
              url: currentSrc || signedPreviewImageUrl,
            });
          }
        }}
      />
    </a>
  );
}

type WorkOrderRow = {
  jobId: string;
  wo_number: string;
  fmKey: string | null;
  status: string | null;
  created_at: string | null;
  scheduled_date: string | null;
  signed_pdf_url: string | null;
  signed_preview_image_url: string | null;
  // include any other fields we use in the existing table rows
  timestamp_extracted: string | null;
  signed_at: string | null;
  work_order_pdf_link: string | null;
};

type Props = {
  jobs: WorkOrderRow[];
};

const FILTERS = ["All", "Signed", "Unsigned", "Needs Review"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Parse filter from URL parameter, defaulting to "All" if invalid.
 */
function parseFilter(param: string | null): Filter {
  if (!param) return "All";
  const normalized = param.toLowerCase();
  if (normalized === "signed") return "Signed";
  if (normalized === "unsigned") return "Unsigned";
  if (normalized === "review" || normalized === "needs-review") return "Needs Review";
  return "All";
}

/**
 * Convert filter to URL parameter format.
 */
function filterToParam(filter: Filter): string {
  if (filter === "All") return "all";
  if (filter === "Needs Review") return "review";
  return filter.toLowerCase();
}

export function WorkOrdersTableClient({ jobs }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Initialize state from URL params
  const [filter, setFilter] = useState<Filter>(() =>
    parseFilter(searchParams.get("filter"))
  );
  const [search, setSearch] = useState(() => searchParams.get("q") || "");

  // Update URL when filter changes (immediate)
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (filter === "All") {
      params.delete("filter");
    } else {
      params.set("filter", filterToParam(filter));
    }

    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [filter, router, searchParams, pathname]);

  // Debounced URL update for search input
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      
      if (search.trim()) {
        params.set("q", search.trim());
      } else {
        params.delete("q");
      }

      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(newUrl, { scroll: false });
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [search, router, searchParams, pathname]);

  const filteredJobs = useMemo(() => {
    let result = jobs;

    if (filter === "Signed") {
      result = result.filter((job) =>
        (job.status || "").toLowerCase().includes("signed")
      );
    } else if (filter === "Unsigned") {
      result = result.filter(
        (job) => !(job.status || "").toLowerCase().includes("signed")
      );
    } else if (filter === "Needs Review") {
      result = result.filter((job) =>
        (job.status || "").toLowerCase().includes("review")
      );
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((job) => {
        const wo = (job.wo_number || "").toLowerCase();
        const fm = (job.fmKey || "").toLowerCase();
        return wo.includes(q) || fm.includes(q);
      });
    }

    return result;
  }, [jobs, filter, search]);

  return (
    <div className="space-y-4">
      {/* Filters + search bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "rounded-full border px-3 py-1 text-sm " +
                (filter === f
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-transparent text-gray-200 border-gray-600 hover:border-blue-400")
              }
            >
              {f}
            </button>
          ))}
        </div>

        <div className="w-full md:w-64">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work order or FM key…"
            className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Result count */}
      <div className="text-sm text-gray-400">
        Showing {filteredJobs.length} of {jobs.length} work orders
      </div>

      {/* Table - Existing JSX with filteredJobs instead of jobs */}
      {filteredJobs.length === 0 ? (
        <p className="text-sm text-gray-400">
          {jobs.length === 0
            ? "No work orders found yet."
            : `No ${filter === "All" ? "" : filter.toLowerCase()} work orders found.`}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-700 rounded-lg bg-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Work Order #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  FM
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Created At
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Scheduled Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Signed PDF
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Snippet
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredJobs.map((row) => (
                <tr key={row.jobId} className="hover:bg-gray-750">
                  <td className="px-4 py-3 whitespace-nowrap text-white font-mono">
                    <Link
                      href={`/pro/work-orders/${row.jobId}`}
                      className="text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      {row.wo_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                    {row.fmKey || "-"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                    {row.status || "OPEN"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400 text-xs">
                    {row.scheduled_date
                      ? new Date(row.scheduled_date).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.signed_pdf_url ? (
                      <a
                        href={row.signed_pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <SnippetImageCell signedPreviewImageUrl={row.signed_preview_image_url} woNumber={row.wo_number} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
