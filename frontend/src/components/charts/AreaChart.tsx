// =============================================================================
// Area Chart Component
// =============================================================================

import { Box, Typography } from "@mui/material";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { findLegendItem, getActualDataKey, getCaseInsensitiveValue } from "./chartUtils";

interface AreaChartProps {
  data: Record<string, any>[];
  xAxisKey: string;
  yAxisKey: string;
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  areaColor?: string;
  yAxisList?: string[]; // Additional Y axis keys for multi-series
  legend?: Array<{ name: string; color: string; description: string; key?: string }>;
  columns?: Array<{ name: string; key: string; type: string }>;
}

export function AreaChartComponent({
  data,
  xAxisKey,
  yAxisKey,
  title,
  xAxisLabel,
  yAxisLabel,
  areaColor = "#ff7f0e",
  yAxisList = [],
  legend = [],
  columns = [],
}: AreaChartProps) {
  // Helper to get column type for formatting
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
        {title || "Area Chart"}
      </Typography>
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
          <defs>
            {actualYAxisKeys.map((key) => {
              const legendItem = findLegendItem(legend, key);
              const color = legendItem?.color || areaColor;
              return (
                <linearGradient key={`gradient-${key}`} id={`color${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.1} />
                </linearGradient>
              );
            })}
          </defs>
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
          />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ paddingBottom: "10px" }} />
          {actualYAxisKeys.map((key) => {
            const legendItem = findLegendItem(legend, key);
            const color = legendItem?.color || areaColor;
            const name = legendItem?.name || key;
            return (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                fill={`url(#color${key})`}
                name={name}
                isAnimationActive={true}
                strokeWidth={2}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
