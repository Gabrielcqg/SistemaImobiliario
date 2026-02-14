"use client";

import { memo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export type PortalChartDatum = {
  portal: string;
  count: number;
};

function PortalDistributionChart({
  data
}: {
  data: PortalChartDatum[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barSize={32}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="portal"
          stroke="#a1a1aa"
          tickLine={false}
          axisLine={false}
        />
        <YAxis stroke="#a1a1aa" tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{
            background: "#0a0a0a",
            border: "1px solid #27272a",
            color: "#f4f4f5"
          }}
        />
        <Bar
          dataKey="count"
          fill="#f4f4f5"
          radius={[8, 8, 0, 0]}
          animationDuration={450}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default memo(PortalDistributionChart);
