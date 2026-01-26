// =============================================================================
// Bar Chart Component - Hover by X-axis index
// =============================================================================

import { useState, useMemo, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Cell } from "recharts";
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

// Custom label component - always visible, bold when hovered
const CustomLabel = (props: any) => {
  const { x, y, width, value, columnType, isHovered } = props;

  // Format value based on column type
  let displayValue = value;
  if (typeof value === "number") {
    if (columnType === "INTEGER") {
      displayValue = Math.round(value).toLocaleString();
    } else if (columnType === "REAL") {
      displayValue = value.toFixed(2);
    } else {
      displayValue = value.toLocaleString();
    }
  }

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill="#333"
      textAnchor="middle"
      fontSize={11}
      fontWeight={isHovered ? "bold" : "normal"}
    >
      {displayValue}
    </text>
  );
};

// Custom X-axis tick component with text truncation and ellipsis
const CustomXAxisTick = (props: any) => {
  const { x, y, payload } = props;
  const maxLength = 15; // Max characters before truncation
  let label = String(payload.value || "");
  
  // Truncate with ellipsis if too long
  if (label.length > maxLength) {
    label = label.substring(0, maxLength - 2) + "...";
  }
  
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={8}
        textAnchor="end"
        fill="#666"
        fontSize={10}
        transform="rotate(-45)"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <title>{payload.value}</title>
        {label}
      </text>
    </g>
  );
};

// Lighten a color for hover effect
const lightenColor = (color: string, amount: number = 0.15): string => {
  const hex = color.replace("#", "");
  const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

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
  // Track hovered X-axis index (all bars at this X position will be highlighted)
  const [hoveredXIndex, setHoveredXIndex] = useState<number | null>(null);

  // Helper function to determine if value should be displayed as integer
  const getColumnType = useCallback((key: string): string => {
    const col = columns.find((c) => c.key === key);
    return col?.type || "unknown";
  }, [columns]);

  // If yAxisList has values, use those; otherwise use just yAxisKey
  const yAxisKeys = yAxisList && yAxisList.length > 0 ? yAxisList : [yAxisKey];

  // Map keys to actual data keys (handle case-insensitive lookups)
  const actualYAxisKeys = useMemo(
    () => yAxisKeys.map((key) => getActualDataKey(data[0] || {}, key)),
    [data, yAxisKeys]
  );

  const chartData = useMemo(
    () =>
      data.map((item) => {
        const chartItem: Record<string, any> = {
          name: String(getCaseInsensitiveValue(item, xAxisKey) ?? ""),
        };
        actualYAxisKeys.forEach((key) => {
          chartItem[key] = Number(getCaseInsensitiveValue(item, key) ?? 0);
        });
        return chartItem;
      }),
    [data, xAxisKey, actualYAxisKeys]
  );

  const handleMouseEnter = useCallback((_: any, index: number) => {
    setHoveredXIndex(index);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredXIndex(null);
  }, []);

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="h6" sx={{ mb: 1, ml: 1, fontWeight: "bold" }}>
        {title || "Bar Chart"}
      </Typography>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart 
          data={chartData} 
          margin={{ top: 40, right: 20, left: 20, bottom: 20 }}
          onMouseLeave={handleMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            height={80}
            tick={<CustomXAxisTick />}
            interval={0}
            label={{ value: xAxisLabel, position: "insideBottom", offset: -5, fontSize: 12, fontWeight: "bold" }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            label={{ value: yAxisLabel, angle: -90, position: "insideLeft", style: { textAnchor: "middle" }, fontSize: 12, fontWeight: "bold" }}
            domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.1)]}
          />
          <Tooltip
            formatter={(value: any, name: string) => {
              if (typeof value === "number") {
                const type = getColumnType(name);
                if (type === "INTEGER") {
                  return [Math.round(value).toLocaleString(), name];
                } else if (type === "REAL") {
                  return [value.toFixed(2), name];
                }
              }
              return [value, name];
            }}
            contentStyle={{ backgroundColor: "rgba(255, 255, 255, 0.95)", border: "1px solid #ccc" }}
            cursor={false}
          />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ paddingBottom: "10px" }} />
          {actualYAxisKeys.map((key) => {
            const legendItem = findLegendItem(legend, key);
            const baseColor = legendItem?.color || barColor;
            const name = legendItem?.name || key;
            const columnType = getColumnType(key);
            
            return (
              <Bar 
                key={key} 
                dataKey={key} 
                fill={baseColor} 
                name={name} 
                radius={[8, 8, 0, 0]}
                isAnimationActive={false}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {/* Cells for individual bar coloring based on hover */}
                {chartData.map((_, index) => {
                  const isHovered = hoveredXIndex === index;
                  return (
                    <Cell
                      key={`cell-${key}-${index}`}
                      fill={isHovered ? lightenColor(baseColor, 0.15) : baseColor}
                      style={{
                        transform: isHovered ? "scaleX(1.1)" : "scaleX(1)",
                        transformOrigin: "center bottom",
                        transformBox: "fill-box",
                        transition: "transform 0.1s ease-out",
                      }}
                    />
                  );
                })}
                {/* Label on top of bar - bold when hovered */}
                <LabelList
                  dataKey={key}
                  position="top"
                  content={(props: any) => (
                    <CustomLabel
                      {...props}
                      columnType={columnType}
                      isHovered={hoveredXIndex === props.index}
                    />
                  )}
                />
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
