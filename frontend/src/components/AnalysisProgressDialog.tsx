/**
 * Analysis Progress Dialog
 * Shows real-time progress of 3-phase database analysis with timer and cancel option
 */

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  LinearProgress,
  Typography,
  Button,
  Stepper,
  Step,
  StepLabel,
  StepConnector,
  styled,
} from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  AccessTime as AccessTimeIcon,
  Close as CloseIcon,
  Pending as PendingIcon,
} from "@mui/icons-material";

interface AnalysisProgressDialogProps {
  open: boolean;
  currentPhase: 0 | 1 | 2 | 3 | 4; // 0 = starting, 1 = phase1, 2 = phase2, 3 = phase3, 4 = completed
  elapsedSeconds: number;
  onCancel: () => void;
}

const phases = [
  { name: "Phase 1", description: "Table Structure Analysis" },
  { name: "Phase 2", description: "Column Explanations" },
  { name: "Phase 3", description: "SQL Examples & Merge" },
];

const StyledStepConnector = styled(StepConnector)(({ theme }) => ({
  "& .MuiStepConnector-line": {
    borderColor: theme.palette.divider,
    borderTopWidth: 2,
  },
  "&.Mui-active .MuiStepConnector-line": {
    borderColor: theme.palette.primary.main,
  },
  "&.Mui-completed .MuiStepConnector-line": {
    borderColor: theme.palette.success.main,
  },
}));

export const AnalysisProgressDialog: React.FC<AnalysisProgressDialogProps> = ({ open, currentPhase, elapsedSeconds, onCancel }) => {
  const [displaySeconds, setDisplaySeconds] = useState(0);

  useEffect(() => {
    setDisplaySeconds(elapsedSeconds);
  }, [elapsedSeconds]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getPhaseStatus = (phaseIndex: number): "completed" | "active" | "pending" => {
    if (phaseIndex < currentPhase - 1) return "completed";
    if (phaseIndex === currentPhase - 1 && currentPhase > 0) return "active";
    return "pending";
  };

  const progressValue = Math.min((currentPhase / 4) * 100, 100);

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown
      PaperProps={{
        sx: {
          backgroundColor: "#f9f9f9",
          borderRadius: 2,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          padding: 2,
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccessTimeIcon sx={{ color: "primary.main" }} />
          <Typography variant="h6" sx={{ flex: 1 }}>
            Database Analysis in Progress
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ py: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Timer */}
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" sx={{ fontWeight: 600, color: "primary.main", mb: 0.5 }}>
              {formatTime(displaySeconds)}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Estimated total: ~6 minutes (120 seconds per phase)
            </Typography>
          </Box>

          {/* Progress Bar */}
          <Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Overall Progress
              </Typography>
              <Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 600 }}>
                {Math.round(progressValue)}%
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={progressValue} sx={{ height: 8, borderRadius: 1 }} />
          </Box>

          {/* Phase Stepper */}
          <Box sx={{ mt: 2 }}>
            <Stepper
              orientation="vertical"
              activeStep={currentPhase - 1}
              connector={<StyledStepConnector />}
              sx={{
                p: 0,
                "& .MuiStep-root": {
                  paddingTop: 1,
                  paddingBottom: 1,
                  paddingLeft: 0,
                  paddingRight: 0,
                },
                "& .MuiStepLabel-root": {
                  paddingLeft: 0,
                  paddingRight: 0,
                },
                "& .MuiStepIcon-root": {
                  marginRight: "12px !important",
                  marginLeft: 0,
                },
              }}
            >
              {phases.map((phase, index) => (
                <Step key={index} completed={getPhaseStatus(index) === "completed"}>
                  <StepLabel
                    StepIconComponent={({ active, completed }) => {
                      if (completed) {
                        return <CheckCircleIcon sx={{ color: "success.main", fontSize: 28 }} />;
                      }
                      if (active) {
                        return <PendingIcon sx={{ color: "primary.main", fontSize: 28 }} />;
                      }
                      return (
                        <Box
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            border: "2px solid",
                            borderColor: "divider",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 600,
                            color: "text.secondary",
                          }}
                        >
                          {index + 1}
                        </Box>
                      );
                    }}
                    sx={{
                      "& .MuiStepLabel-label": {
                        fontSize: "0.95rem",
                        fontWeight: getPhaseStatus(index) === "active" ? 600 : 500,
                        color: getPhaseStatus(index) === "completed" ? "success.main" : undefined,
                      },
                      "& .MuiStepLabel-label.Mui-active": {
                        color: "primary.main",
                        fontWeight: 600,
                      },
                      "& .MuiStepLabel-iconContainer": {
                        paddingRight: 2,
                        paddingLeft: 0,
                      },
                    }}
                  >
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {phase.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {phase.description}
                      </Typography>
                    </Box>
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>

          {/* Status Message */}
          {currentPhase === 0 && (
            <Typography variant="body2" sx={{ color: "info.main", textAlign: "center", fontStyle: "italic" }}>
              Initializing analysis...
            </Typography>
          )}
          {currentPhase > 0 && currentPhase < 4 && (
            <Typography variant="body2" sx={{ color: "primary.main", textAlign: "center", fontStyle: "italic" }}>
              {phases[currentPhase - 1].name} in progress... ({currentPhase}/3)
            </Typography>
          )}
          {currentPhase === 4 && (
            <Typography variant="body2" sx={{ color: "success.main", textAlign: "center", fontStyle: "italic" }}>
              ✓ Analysis completed!
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
        <Button onClick={onCancel} variant="contained" color="error" startIcon={<CloseIcon />} disabled={currentPhase === 4} fullWidth>
          {currentPhase === 4 ? "Close" : "Cancel Analysis"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AnalysisProgressDialog;
