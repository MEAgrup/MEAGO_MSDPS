"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/layout";
import Link from "next/link";

type VideoGmvRow = {
  id: number;
  creator_id: string;
  video_id: string;
  video_title: string | null;
  period_start: string;
  period_end: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  sales_value: number;
  orders: number;
  conversion_rate: number;
  creator_name?: string;
  creator_username?: string;
};

export function VideoGmvTable() {
  const [rows, setRows] = useState<VideoGmvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = await createClient();
        const { data, error: err } = await supabase
          .from("creator_video_gmv")
          .select(
            `
            id,
            creator_id,
            video_id,
            video_title,
            period_start,
            period_end,
            views,
            likes,
            comments,
            shares,
            sales_value,
            orders,
            conversion_rate,
            creator:mcn_creators(id, name, username)
          `
          )
          .order("period_start", { ascending: false })
          .order("sales_value", { ascending: false })
          .limit(100);

        if (err) {
          setError(err.message);
          setLoading(false);
          return;
        }

        const formatted = (data ?? []).map((row: any) => ({
          ...row,
          creator_name: row.creator?.name,
          creator_username: row.creator?.username,
        }));

        setRows(formatted);
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return <Card>Loading...</Card>;
  }

  if (error) {
    return <Card className="text-red-600">Error: {error}</Card>;
  }

  if (rows.length === 0) {
    return <Card className="text-neutral-500">Belum ada data video GMV.</Card>;
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b bg-neutral-50">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Creator</th>
              <th className="text-left px-3 py-2 font-semibold">Video</th>
              <th className="text-left px-3 py-2 font-semibold">Period</th>
              <th className="text-right px-3 py-2 font-semibold">Views</th>
              <th className="text-right px-3 py-2 font-semibold">Likes</th>
              <th className="text-right px-3 py-2 font-semibold">GMV</th>
              <th className="text-right px-3 py-2 font-semibold">Orders</th>
              <th className="text-right px-3 py-2 font-semibold">Conv%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <Link
                    href={`/meago/creators/${row.creator_id}`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {row.creator_name || row.creator_username || row.creator_id}
                  </Link>
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate" title={row.video_title || ""}>
                  {row.video_title || row.video_id}
                </td>
                <td className="px-3 py-2 text-neutral-600">
                  {row.period_start} - {row.period_end}
                </td>
                <td className="text-right px-3 py-2">{row.views.toLocaleString()}</td>
                <td className="text-right px-3 py-2">{row.likes.toLocaleString()}</td>
                <td className="text-right px-3 py-2 font-medium">
                  {typeof row.sales_value === "number"
                    ? `Rp ${(row.sales_value / 1000000).toFixed(2)}M`
                    : "-"}
                </td>
                <td className="text-right px-3 py-2">{row.orders}</td>
                <td className="text-right px-3 py-2">{row.conversion_rate.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
