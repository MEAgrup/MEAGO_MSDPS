"use client";

import { useState, useTransition } from "react";
import { getCreatorReportUrl } from "@/lib/actions/creator-reports";

export function DownloadButton({ reportId }: { reportId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await getCreatorReportUrl(reportId);
      if (res.ok && res.url) {
        window.open(res.url, "_blank");
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={pending}>
        {pending ? "Menyiapkan…" : "Unduh"}
      </button>
      {error && (
        <div className="err" style={{ marginTop: 4 }}>
          {error}
        </div>
      )}
    </>
  );
}
