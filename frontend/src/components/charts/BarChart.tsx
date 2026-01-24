// =============================================================================
// Bar Chart Component
// =============================================================================

import { Box, Typography } from "@mui/material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { findLegendItem, getActualDataKey, getCaseInsensitiveValue } from "./chartUtils";

interface BarChartProps {
  data: Record<string, any>[];
  xAxisKey: string;
  yAxisKey: string;
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  barColor?: string;
  yAxisList?: string[]; // Additional Y axis keys for multi-series
  legend?: Array<{ name: string; color: string; description: string; key?: string }>;
  columns?: Array<{ name: string; key: string; type: string }>;
}

export function BarChartComponent({
  data,
  xAxisKey,
  yAxisKey,
  title,
  xAxisLabel,
  yAxisLabel,
  barColor = "#1f77b4",
  yAxisList = [],
  legend = [],
  columns = [],
}: BarChartProps) {
  // Helper function to determine if value should be displayed as integer
  const getColumnType = (key: string): string => {
    const col = columns.find((c) => c.key === key);
    return col?.type || "unknown";
  };

  // If yAxisList has values, use those; otherwise use just yAxisKey
  const yAxisKeys = yAxisList && yAxisList.length > 0 ? yAxisList : [yAxisKey];

  // Map keys to actual data keys (handle case-insensitive lookups)
  const actualYAxisKeys = yAxisKeys.map((key) => getActualDataKey(data[0] || {}, key));

  const chartData = data.map((item) => {
    const chartItem: Record<string, any> = {
      name: String(getCaseInsensitiveValue(item, xAxisKey) ?? ""),
    };
    actualYAxisKeys.forEach((key) => {
      chartItem[key] = Number(getCaseInsensitiveValue(item, key) ?? 0);
    });
    return chartItem;
  });

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="h6" sx={{ mb: 1, ml: 1, fontWeight: "bold" }}>
        {title || "Bar Chart"}
      </Typography>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            angle={45}
            textAnchor="start"
            height={60}
            tick={{ fontSize: 10 }}
            label={{ value: xAxisLabel, position: "insideBottom", offset: 0, fontSize: 12, fontWeight: "bold" }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            label={{ value: yAxisLabel, angle: -90, position: "insideLeft", offset: 0, fontSize: 12, fontWeight: "bold" }}
          />
          <Tooltip
            formatter={(value: any, name: string) => {
              if (typeof value === "number") {
                const type = getColumnType(name);
                if (type === "INTEGER") {
                  return [Math.round(value).toString(), name];
                } else if (type === "REAL") {
                  return [value.toFixed(2), name];
                }
              }
              return [value, name];
            }}
            contentStyle={{ backgroundColor: "rgba(255, 255, 255, 0.95)", border: "1px solid #ccc" }}
            cursor={{ fill: "rgba(200, 200, 200, 0.2)" }}
          />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ paddingBottom: "10px" }} />
          {actualYAxisKeys.map((key) => {
            const legendItem = findLegendItem(legend, key);
            const color = legendItem?.color || barColor;
            const name = legendItem?.name || key;
            return <Bar key={key} dataKey={key} fill={color} name={name} radius={[8, 8, 0, 0]} isAnimationActive={true} />;
          })}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
