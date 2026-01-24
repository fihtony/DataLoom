// =============================================================================
// Chart Viewer - Reusable component to display data with multiple chart types
// =============================================================================

import { useState } from "react";
import { Box, Paper, Tabs, Tab, Collapse, IconButton, Tooltip, Alert, Divider, Typography } from "@mui/material";
import { ExpandMore as ExpandMoreIcon, ContentCopy as ContentCopyIcon } from "@mui/icons-material";
import { TableChart } from "./charts/TableChart";
import { PieChartComponent } from "./charts/PieChart";
import { BarChartComponent } from "./charts/BarChart";
import { LineChartComponent } from "./charts/LineChart";
import { AreaChartComponent } from "./charts/AreaChart";
import { detectYAxisKeys } from "./charts/chartUtils";

// ============= Type Definitions =============

export interface ChartViewerDataset {
  name: string;
  title: string;
  description: string;
  sql?: string; // SQL query
  data: Record<string, any>[];
  columns: { name: string; key: string; type: string }[];
  rowCount?: number; // Number of rows
  executionTimeMs?: number; // Execution time in milliseconds
  visualization?: {
    type: string;
    xAxis: string;
    yAxis: string; // Primary Y axis
    yAxisList?: string[]; // Additional Y axes for multi-series charts
    title: string;
    groupBy: string | null;
    legend: Array<{ name: string; color: string; description: string }>;
    xAxisLabel: string | null;
    yAxisLabel: string | null;
  };
}

interface ChartViewerProps {
  dataset: ChartViewerDataset;
  showHeader?: boolean;
  showJson?: boolean;
  onJsonCopy?: (data: any) => void;
}

// ============= Component =============

export function ChartViewer({ dataset, showHeader = true, showJson = true, onJsonCopy }: ChartViewerProps) {
  const [tabValue, setTabValue] = useState(0);
  const [expandJson, setExpandJson] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleCopyJson = async () => {
    // Build complete API response format
    const jsonData = {
      success: true,
      data: {
        sql: dataset.sql || "",
        data: dataset.data,
        columns: dataset.columns,
        rowCount: dataset.rowCount || dataset.data.length,
        executionTimeMs: dataset.executionTimeMs || 0,
        visualization: dataset.visualization,
      },
      explanation: dataset.description,
      timestamp: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
      onJsonCopy?.(jsonData);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const viz = dataset.visualization || {
    type: "bar",
    xAxis: "",
    yAxis: "",
    title: "",
    groupBy: null,
    legend: [],
    xAxisLabel: null,
    yAxisLabel: null,
  };
  const primaryColor = viz.legend?.[0]?.color || "#1f77b4";

  // Detect Y-axis keys by mapping legend names to actual column names
  const yAxisList = detectYAxisKeys(dataset.columns, viz.legend, viz.yAxis);

  const chartConfigs = [
    {
      label: "Table",
      render: () => <TableChart data={dataset.data} columns={dataset.columns} title={viz.title || ""} />,
    },
    {
      label: "Pie",
      render: () => (
        <PieChartComponent
          data={dataset.data}
          nameKey={dataset.columns[0]?.key || dataset.columns[0]?.name || ""}
          valueKey={dataset.columns[1]?.key || dataset.columns[1]?.name || ""}
          title={viz.title || ""}
          colors={viz.legend?.map((l) => l.color) || []}
          yAxisList={yAxisList.length > 0 ? yAxisList : undefined}
          legend={viz.legend}
        />
      ),
    },
    {
      label: "Bar",
      render: () => (
        <BarChartComponent
          data={dataset.data}
          xAxisKey={viz.xAxis || dataset.columns[0]?.key || dataset.columns[0]?.name || ""}
          yAxisKey={viz.yAxis || dataset.columns[1]?.key || dataset.columns[1]?.name || ""}
          title={viz.title || ""}
          xAxisLabel={viz.xAxisLabel || undefined}
          yAxisLabel={viz.yAxisLabel || undefined}
          barColor={primaryColor}
          yAxisList={yAxisList.length > 0 ? yAxisList : undefined}
          legend={viz.legend}
          columns={dataset.columns}
        />
      ),
    },
    {
      label: "Line",
      render: () => (
        <LineChartComponent
          data={dataset.data}
          xAxisKey={viz.xAxis || dataset.columns[0]?.key || dataset.columns[0]?.name || ""}
          yAxisKey={viz.yAxis || dataset.columns[1]?.key || dataset.columns[1]?.name || ""}
          title={viz.title || ""}
          xAxisLabel={viz.xAxisLabel || undefined}
          yAxisLabel={viz.yAxisLabel || undefined}
          lineColor={primaryColor}
          yAxisList={yAxisList.length > 0 ? yAxisList : undefined}
          legend={viz.legend}
          columns={dataset.columns}
        />
      ),
    },
    {
      label: "Area",
      render: () => (
        <AreaChartComponent
          data={dataset.data}
          xAxisKey={viz.xAxis || dataset.columns[0]?.key || dataset.columns[0]?.name || ""}
          yAxisKey={viz.yAxis || dataset.columns[1]?.key || dataset.columns[1]?.name || ""}
          title={viz.title || ""}
          xAxisLabel={viz.xAxisLabel || undefined}
          yAxisLabel={viz.yAxisLabel || undefined}
          areaColor={primaryColor}
          yAxisList={yAxisList.length > 0 ? yAxisList : undefined}
          legend={viz.legend}
          columns={dataset.columns}
        />
      ),
    },
  ];

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      {/* Dataset Header */}
      {showHeader && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: "bold" }}>
            {dataset.name}: {dataset.title}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            {dataset.description} • {dataset.data.length} rows
          </Typography>
        </Box>
      )}

      {/* Chart Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange}>
          {chartConfigs.map((config, idx) => (
            <Tab key={idx} label={config.label} />
          ))}
        </Tabs>
      </Box>

      {/* Chart Content */}
      <Box sx={{ mb: 3 }}>{chartConfigs[tabValue]?.render()}</Box>

      {/* JSON Section */}
      {showJson && (
        <>
          <Divider sx={{ my: 3 }} />

          <Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                p: 1.5,
                bgcolor: "grey.100",
                borderRadius: 1,
                mb: expandJson ? 1 : 0,
                "&:hover": { bgcolor: "grey.200" },
              }}
              onClick={() => setExpandJson(!expandJson)}
            >
              <Typography variant="body2" sx={{ fontWeight: "bold", color: "text.secondary" }}>
                📋 Query Response JSON
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Tooltip title={copyFeedback ? "Copied!" : "Copy JSON"}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyJson();
                    }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <ExpandMoreIcon
                  sx={{
                    transform: expandJson ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.3s",
                  }}
                />
              </Box>
            </Box>

            <Collapse in={expandJson}>
              <Box
                sx={{
                  bgcolor: "grey.900",
                  color: "grey.100",
                  p: 2,
                  borderRadius: 1,
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  maxHeight: "400px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(
                  {
                    success: true,
                    data: {
                      sql: dataset.sql || "",
                      data: dataset.data,
                      columns: dataset.columns,
                      rowCount: dataset.rowCount || dataset.data.length,
                      executionTimeMs: dataset.executionTimeMs || 0,
                      visualization: dataset.visualization,
                    },
                    explanation: dataset.description,
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2,
                )}
              </Box>
              {copyFeedback && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  JSON copied to clipboard!
                </Alert>
              )}
            </Collapse>
          </Box>
        </>
      )}
    </Paper>
  );
}
