// =============================================================================
// Query Result Visualizer - Display query results using chart components
// =============================================================================

import { useState } from "react";
import { Box, Button, ButtonGroup, Typography, IconButton, Collapse } from "@mui/material";
import {
  TableChart as TableIcon,
  BarChart as BarChartIcon,
  PieChart as PieChartIcon,
  ShowChart as LineChartIcon,
  Timeline as AreaChartIcon,
  ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";
import { PieChartComponent } from "./charts/PieChart";
import { BarChartComponent } from "./charts/BarChart";
import { LineChartComponent } from "./charts/LineChart";
import { AreaChartComponent } from "./charts/AreaChart";
import { TableChart } from "./charts/TableChart";

interface QueryResult {
  sql?: string;
  data?: any[];
  columns?: Array<{ name: string; key: string; type: string }>;
  rowCount?: number;
  visualization?: {
    type?: "table" | "bar" | "pie" | "line" | "area" | "kpi";
    xAxis?: string;
    yAxis?: string | string[];
    title?: string;
    groupBy?: string;
    legend?: Array<{
      name: string;
      key?: string;
      color: string;
      description: string;
    }>;
    xAxisLabel?: string;
    yAxisLabel?: string;
    alternatives?: string[];
  };
}

interface QueryResultVisualizerProps {
  result: QueryResult;
  explanation?: string;
}

export function QueryResultVisualizer({ result }: QueryResultVisualizerProps) {
  const viz = result.visualization;
  const [viewType, setViewType] = useState<"table" | "bar" | "pie" | "line" | "area">((viz?.type as any) || "table");
  const [sqlExpanded, setSqlExpanded] = useState(false);

  // Show error/empty state with SQL if available
  if (!result.data || result.data.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ p: 2, bgcolor: "grey.50", borderRadius: 1 }}>
          <Typography color="textSecondary">No data returned from query</Typography>
        </Box>

        {/* SQL Display */}
        {result.sql && (
          <Box sx={{ border: "1px solid #e0e0e0", borderRadius: 1, overflow: "hidden" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                p: 1,
                bgcolor: "grey.900",
                cursor: "pointer",
                "&:hover": { bgcolor: "grey.800" },
              }}
              onClick={() => setSqlExpanded(!sqlExpanded)}
            >
              <Typography variant="caption" sx={{ color: "grey.400", fontSize: "0.7rem" }}>
                Generated SQL
              </Typography>
              <IconButton
                size="small"
                sx={{
                  transform: sqlExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.3s",
                }}
              >
                <ExpandMoreIcon sx={{ fontSize: "1rem", color: "grey.400" }} />
              </IconButton>
            </Box>
            <Collapse in={sqlExpanded}>
              <Box sx={{ p: 1.5, bgcolor: "grey.900" }}>
                <Typography
                  variant="caption"
                  component="div"
                  sx={{
                    fontFamily: "monospace",
                    color: "grey.200",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: "0.7rem",
                  }}
                >
                  {result.sql}
                </Typography>
              </Box>
            </Collapse>
          </Box>
        )}
      </Box>
    );
  }

  // Determine if we can show charts (need at least columns and axes defined)
  const hasColumns = result.columns && result.columns.length >= 2;
  const hasAxes = viz?.xAxis || viz?.groupBy;
  const canShowChart = hasColumns && hasAxes;

  // Get available chart types to display
  const availableCharts: Array<"table" | "bar" | "pie" | "line" | "area"> = ["table"];
  if (canShowChart) {
    availableCharts.push("bar", "pie", "line", "area");
  }

  // Filter to only show available chart types
  if (!availableCharts.includes(viewType)) {
    setViewType("table");
  }

  // Render the appropriate chart based on current view type
  const renderChart = () => {
    if (!result.data) return null;

    const commonProps = {
      data: result.data,
      title: viz?.title || "Chart",
      legend: viz?.legend || [],
      columns: result.columns || [],
    };

    switch (viewType) {
      case "table":
        return <TableChart {...commonProps} data={result.data} />;

      case "bar":
        if (!viz?.xAxis || !viz?.yAxis) return null;
        const barYAxisKeys = Array.isArray(viz.yAxis) ? viz.yAxis : [viz.yAxis as string];
        return (
          <BarChartComponent
            {...commonProps}
            xAxisKey={viz.xAxis}
            yAxisKey={Array.isArray(viz.yAxis) ? viz.yAxis[0] : viz.yAxis}
            xAxisLabel={viz.xAxisLabel}
            yAxisLabel={viz.yAxisLabel}
            yAxisList={barYAxisKeys.length > 0 ? barYAxisKeys : undefined}
          />
        );

      case "pie":
        if (!viz?.groupBy && !viz?.xAxis) return null;
        const nameKey = viz.groupBy || viz.xAxis || "";
        const valueKey = viz.yAxis ? (Array.isArray(viz.yAxis) ? viz.yAxis[0] : viz.yAxis) : "";
        return (
          <PieChartComponent
            {...commonProps}
            data={result.data}
            nameKey={nameKey}
            valueKey={valueKey}
            yAxisList={Array.isArray(viz.yAxis) ? viz.yAxis : undefined}
          />
        );

      case "line":
        if (!viz?.xAxis || !viz?.yAxis) return null;
        const lineYAxisKeys = Array.isArray(viz.yAxis) ? viz.yAxis : [viz.yAxis as string];
        return (
          <LineChartComponent
            {...commonProps}
            xAxisKey={viz.xAxis}
            yAxisKey={Array.isArray(viz.yAxis) ? viz.yAxis[0] : viz.yAxis}
            xAxisLabel={viz.xAxisLabel}
            yAxisLabel={viz.yAxisLabel}
            yAxisList={lineYAxisKeys.length > 0 ? lineYAxisKeys : undefined}
          />
        );

      case "area":
        if (!viz?.xAxis || !viz?.yAxis) return null;
        const areaYAxisKeys = Array.isArray(viz.yAxis) ? viz.yAxis : [viz.yAxis as string];
        return (
          <AreaChartComponent
            {...commonProps}
            xAxisKey={viz.xAxis}
            yAxisKey={Array.isArray(viz.yAxis) ? viz.yAxis[0] : viz.yAxis}
            xAxisLabel={viz.xAxisLabel}
            yAxisLabel={viz.yAxisLabel}
            yAxisList={areaYAxisKeys.length > 0 ? areaYAxisKeys : undefined}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      {/* Chart Type Selector */}
      {canShowChart && (
        <Box sx={{ mb: 2, display: "flex", justifyContent: "center", gap: 1 }}>
          <ButtonGroup size="small" variant="outlined">
            {availableCharts.map((type) => {
              const iconMap: Record<string, React.ReactNode> = {
                table: <TableIcon />,
                bar: <BarChartIcon />,
                pie: <PieChartIcon />,
                line: <LineChartIcon />,
                area: <AreaChartIcon />,
              };

              return (
                <Button
                  key={type}
                  startIcon={iconMap[type]}
                  onClick={() => setViewType(type)}
                  variant={viewType === type ? "contained" : "outlined"}
                  sx={{ fontSize: "0.75rem", textTransform: "capitalize" }}
                >
                  {type}
                </Button>
              );
            })}
          </ButtonGroup>
        </Box>
      )}

      {/* Chart Container */}
      <Box sx={{ border: "1px solid #e0e0e0", borderRadius: 1, overflow: "hidden", mb: 2 }}>{renderChart()}</Box>

      {/* SQL Display */}
      {result.sql && (
        <Box sx={{ border: "1px solid #e0e0e0", borderRadius: 1, overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              p: 1,
              bgcolor: "grey.900",
              cursor: "pointer",
              "&:hover": { bgcolor: "grey.800" },
            }}
            onClick={() => setSqlExpanded(!sqlExpanded)}
          >
            <Typography variant="caption" sx={{ color: "grey.400", fontSize: "0.7rem" }}>
              Generated SQL
            </Typography>
            <IconButton
              size="small"
              sx={{
                transform: sqlExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.3s",
              }}
            >
              <ExpandMoreIcon sx={{ fontSize: "1rem", color: "grey.400" }} />
            </IconButton>
          </Box>
          <Collapse in={sqlExpanded}>
            <Box sx={{ p: 1.5, bgcolor: "grey.900" }}>
              <Typography
                variant="caption"
                component="div"
                sx={{
                  fontFamily: "monospace",
                  color: "grey.200",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontSize: "0.7rem",
                }}
              >
                {result.sql}
              </Typography>
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}
