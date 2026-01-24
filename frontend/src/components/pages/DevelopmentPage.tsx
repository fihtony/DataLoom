// =============================================================================
// Development Page - UI/UX Experimentation for Chart Styles
// =============================================================================

import { useState, useEffect } from "react";
import { Box, Container, Typography, Paper, Alert, CircularProgress } from "@mui/material";
import { ChartViewer, ChartViewerDataset } from "../ChartViewer";

// ============= Type Definitions =============

interface ApiDataset {
  success: boolean;
  data: {
    sql: string;
    data: Record<string, any>[];
    columns: Array<{ name: string; key: string; type: string }>;
    rowCount: number;
    executionTimeMs: number;
    visualization: {
      type: string;
      xAxis: string;
      yAxis: string;
      title: string;
      groupBy: string | null;
      legend: Array<{ name: string; color: string; description: string }>;
      xAxisLabel: string | null;
      yAxisLabel: string | null;
    };
  };
  explanation: string;
  timestamp: string;
}

// ============= Main Component =============

export function DevelopmentPage() {
  const [datasets, setDatasets] = useState<ChartViewerDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDatasets = async () => {
      try {
        setLoading(true);
        setError(null);

        const loadedDatasets: ChartViewerDataset[] = [];

        // Load all 12 datasets from JSON files
        for (let i = 1; i <= 12; i++) {
          try {
            const response = await import(`../../data/datasets/dataset${i}.json`);
            const apiDataset: ApiDataset = response.default;

            loadedDatasets.push({
              name: `dataset${i}`,
              title: apiDataset.data.visualization.title,
              description: apiDataset.explanation,
              sql: apiDataset.data.sql,
              data: apiDataset.data.data,
              columns: apiDataset.data.columns,
              rowCount: apiDataset.data.rowCount,
              executionTimeMs: apiDataset.data.executionTimeMs,
              visualization: apiDataset.data.visualization,
            });
          } catch (err) {
            console.error(`Failed to load dataset${i}:`, err);
          }
        }

        setDatasets(loadedDatasets);
      } catch (err) {
        setError("Failed to load datasets");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadDatasets();
  }, []);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4, display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <CircularProgress />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Loading datasets...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error || datasets.length === 0) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Alert severity="error">{error || "No datasets loaded"}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4, display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: "bold" }}>
          📊 Development - Chart Style Experimentation
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          这个页面展示了不同的图表可视化样式，包括表格、饼图、柱状图、折线图和面积图。每个数据集都支持所有图表类型。使用标签页切换，或展开
          JSON 数据查看原始响应格式。所有图表都遵循 JSON 中定义的可视化配置。
        </Typography>
      </Box>

      <Box sx={{ overflowY: "auto", flex: 1, pr: 1 }}>
        {datasets.map((dataset) => (
          <ChartViewer key={dataset.name} dataset={dataset} showHeader={true} showJson={true} />
        ))}

        <Paper sx={{ p: 2, mb: 4, bgcolor: "info.light" }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            💡 <strong>提示：</strong> 所有数据集都从独立的 JSON 文件加载，遵循 /api/query 端点响应格式。图表使用 JSON
            中定义的标题、坐标轴标签、图例和颜色。JSON 数据可复制到剪贴板，用于测试或文档。
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
}
