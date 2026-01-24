// =============================================================================
// Pie Chart Component
// =============================================================================

import { Box, Typography } from "@mui/material";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import { findLegendItem, getActualDataKey, getCaseInsensitiveValue } from "./chartUtils";

interface PieChartProps {
  data: Record<string, any>[];
  nameKey: string;
  valueKey: string;
  title: string;
  colors?: string[];
  yAxisList?: string[]; // Multiple value keys for multi-series pie charts
  legend?: Array<{ name: string; color: string; description: string }>;
}

const DEFAULT_COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D", "#FFC658", "#FF7C7C"];

/**
 * Generate a color palette from a base color
 * Creates variations by rotating hue around the color wheel
 */
function generateColorPalette(baseColor: string, count: number): string[] {
  if (count <= 1) return [baseColor];

  // Parse hex color to RGB
  const hex = baseColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Convert RGB to HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / (max - min) / 6 + (g < b ? 1 : 0);
        break;
      case g:
        h = (b - r) / (max - min) / 6 + 1 / 3;
        break;
      case b:
        h = (r - g) / (max - min) / 6 + 2 / 3;
        break;
    }
  }

  // Generate palette by varying hue significantly for better distinction
  const palette: string[] = [];
  for (let i = 0; i < count; i++) {
    const ratio = i / count;
    // Rotate hue for distinctly different colors
    let newH = (h + ratio * 0.7) % 1;
    // Vary saturation and lightness for distinction
    let newS = 0.6 + ratio * 0.35;
    let newL = 0.45 + Math.sin(ratio * Math.PI) * 0.1;

    // Convert HSL back to RGB
    const c = (1 - Math.abs(2 * newL - 1)) * newS;
    const x = c * (1 - Math.abs(((newH * 6) % 2) - 1));
    const m = newL - c / 2;

    let r2, g2, b2;
    const h6 = newH * 6;
    if (h6 < 1) {
      r2 = c;
      g2 = x;
      b2 = 0;
    } else if (h6 < 2) {
      r2 = x;
      g2 = c;
      b2 = 0;
    } else if (h6 < 3) {
      r2 = 0;
      g2 = c;
      b2 = x;
    } else if (h6 < 4) {
      r2 = 0;
      g2 = x;
      b2 = c;
    } else if (h6 < 5) {
      r2 = x;
      g2 = 0;
      b2 = c;
    } else {
      r2 = c;
      g2 = 0;
      b2 = x;
    }

    const toHex = (val: number) =>
      Math.round((val + m) * 255)
        .toString(16)
        .padStart(2, "0");
    palette.push(`#${toHex(r2)}${toHex(g2)}${toHex(b2)}`);
  }

  return palette;
}

export function PieChartComponent({ data, nameKey, valueKey, title, colors = DEFAULT_COLORS, yAxisList = [], legend = [] }: PieChartProps) {
  // If yAxisList has values, use those; otherwise use just valueKey
  const valueKeys = yAxisList && yAxisList.length > 0 ? yAxisList : [valueKey];

  // Map keys to actual data keys (handle case-insensitive lookups)
  const actualNameKey = getActualDataKey(data[0] || {}, nameKey);
  const actualValueKeys = valueKeys.map((key) => getActualDataKey(data[0] || {}, key));

  const renderPie = (key: string, customColors: string[]) => {
    const chartData = data
      .map((item) => ({
        name: String(getCaseInsensitiveValue(item, actualNameKey) ?? ""),
        value: Number(getCaseInsensitiveValue(item, key) ?? 0),
      }))
      .filter((item) => item.value > 0); // Filter out zero values

    const legendItem = findLegendItem(legend, key);
    const pieTitle = legendItem?.name || key;
    const baseColor = legendItem?.color || customColors[0] || DEFAULT_COLORS[0];

    // Generate color palette from base color
    const pieColors = generateColorPalette(baseColor, chartData.length);

    return (
      <Box key={key} sx={{ flex: 1, minWidth: "400px" }}>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: "bold", textAlign: "center" }}>
          {pieTitle}
        </Typography>
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={(props: any) => {
                const { cx, cy, midAngle, outerRadius, value, percent } = props;
                // Position label outside the pie chart, with some padding
                const radius = outerRadius + 35;
                const x = cx + radius * Math.cos((-midAngle * Math.PI) / 180);
                const y = cy + radius * Math.sin((-midAngle * Math.PI) / 180);
                return (
                  <text
                    x={x}
                    y={y}
                    fill="#333333"
                    textAnchor={x > cx ? "start" : "end"}
                    dominantBaseline="central"
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {`${value} (${(percent * 100).toFixed(1)}%)`}
                  </text>
                );
              }}
              outerRadius={120}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) =>
                `${value} (${(((value as number) / chartData.reduce((sum, item) => sum + item.value, 0)) * 100).toFixed(1)}%)`
              }
              contentStyle={{
                fontSize: "12px",
                padding: "0px 5px",
                backgroundColor: "rgba(255, 255, 255, 0.95)",
                border: "1px solid #ccc",
              }}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{
                paddingLeft: "20px",
                fontSize: "11px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </Box>
    );
  };

  const customColors = colors.length > 0 ? colors : DEFAULT_COLORS;

  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="h6" sx={{ mb: 2, ml: 1, fontWeight: "bold" }}>
        {title || "Pie Chart"}
      </Typography>
      {valueKeys.length > 1 ? (
        <Box sx={{ display: "flex", gap: 2, justifyContent: "space-around", flexWrap: "wrap" }}>
          {actualValueKeys.map((key) => renderPie(key, customColors))}
        </Box>
      ) : (
        renderPie(actualValueKeys[0], customColors)
      )}
    </Box>
  );
}
