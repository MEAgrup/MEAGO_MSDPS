"use client";

import { useActionState } from "react";
import { runVideoGmvIngest, type ActionResult } from "@/lib/actions/video-ingest";
import { Card } from "@/components/layout";

type FormState = ActionResult | null;

export function VideoGmvUploadForm({ userId, userName }: { userId: string; userName: string | null }) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await runVideoGmvIngest(null, formData);
      return result;
    },
    null
  );

  return (
    <Card className="sticky top-20">
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-sm">Upload Video GMV</h3>
          <p className="text-xs text-neutral-500 mt-1">
            Format: XLSX dengan sheet "Filter" (periode) dan "Data" (video metrics).
          </p>
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="source_type" value="tiktok" />

          <div>
            <label htmlFor="file" className="block text-xs font-medium mb-2">
              File XLSX
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".xlsx,.xls"
              required
              disabled={isPending}
              className="block w-full text-xs border border-neutral-200 rounded px-2 py-2 file:mr-3 file:px-2 file:py-1 file:text-xs file:bg-neutral-100 file:border-0 file:rounded disabled:opacity-50"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="force_reprocess"
              value="1"
              disabled={isPending}
              className="w-4 h-4 rounded border-neutral-300 text-blue-600 focus:ring-2"
            />
            <span className="text-xs">Proses ulang jika file duplikat</span>
          </label>

          <button
            type="submit"
            disabled={isPending}
            className="w-full px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isPending ? "Processing..." : "Upload & Ingest"}
          </button>
        </form>

        {state && (
          <div
            className={`p-3 rounded text-xs ${
              state.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {state.message}
          </div>
        )}
      </div>
    </Card>
  );
}
