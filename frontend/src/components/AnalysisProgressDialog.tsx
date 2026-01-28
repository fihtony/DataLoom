/**
 * Analysis Progress Dialog
 * Shows real-time progress of 3-phase database analysis with timer and cancel option.
 * Failed steps show a red cross; overall progress is red when any step failed.
 */

import React, { useEffect, useState, useMemo } from "react";
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
  Cancel as CancelIcon,
  AccessTime as AccessTimeIcon,
  Close as CloseIcon,
  Pending as PendingIcon,
} from "@mui/icons-material";

export type PhaseStatus = "success" | "failed" | "active" | "pending";

interface AnalysisProgressDialogProps {
  open: boolean;
  currentPhase: 0 | 1 | 2 | 3 | 4; // 0 = starting, 1 = phase1, 2 = phase2, 3 = phase3, 4 = completed
  elapsedSeconds: number;
  phases?: { phase1: string; phase2: string; phase3: string } | null;
  onCancel: () => void;
}

const PHASE_META = [
  { name: "Phase 1", description: "Table Structure Analysis" },
  { name: "Phase 2", description: "Column Explanations" },
  { name: "Phase 3", description: "SQL Examples & Merge" },
];

function phaseStatusFromMessage(msg: string | undefined, phaseIndex: number, currentPhase: number): PhaseStatus {
  if (!msg) {
    if (phaseIndex < currentPhase - 1) return "success";
    if (phaseIndex === currentPhase - 1 && currentPhase > 0) return "active";
    return "pending";
  }
  if (/✓/.test(msg)) return "success";
  if (/[✗⊘]/.test(msg)) return "failed";
  if (phaseIndex === currentPhase - 1 && currentPhase > 0) return "active";
  if (phaseIndex < currentPhase - 1) return "success";
  return "pending";
}

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

export const AnalysisProgressDialog: React.FC<AnalysisProgressDialogProps> = ({
  open,
  currentPhase,
  elapsedSeconds,
  phases,
  onCancel,
}) => {
  const [displaySeconds, setDisplaySeconds] = useState(0);

  useEffect(() => {
    setDisplaySeconds(elapsedSeconds);
  }, [elapsedSeconds]);

  const phaseStatuses = useMemo((): PhaseStatus[] => {
    return [0, 1, 2].map((i) =>
      phaseStatusFromMessage(
        phases ? (i === 0 ? phases.phase1 : i === 1 ? phases.phase2 : phases.phase3) : undefined,
        i,
        currentPhase
      )
    );
  }, [phases, currentPhase]);

  const anyFailed = phaseStatuses.some((s) => s === "failed");
  const progressColor = anyFailed ? "error" : "primary";

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
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
          <AccessTimeIcon sx={{ color: `${progressColor}.main` }} />
          <Typography variant="h6" sx={{ flex: 1 }}>
            Database Analysis in Progress
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ py: 3 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Timer */}
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" sx={{ fontWeight: 600, color: `${progressColor}.main`, mb: 0.5 }}>
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
              <Typography variant="subtitle2" sx={{ color: `${progressColor}.main`, fontWeight: 600 }}>
                {Math.round(progressValue)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progressValue}
              color={progressColor}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>

          {/* Phase Stepper */}
          <Box sx={{ mt: 2 }}>
            <Stepper
              orientation="vertical"
              activeStep={Math.max(0, Math.min(currentPhase, 3) - 1)}
              connector={<StyledStepConnector />}
              sx={{
                p: 0,
                "& .MuiStep-root": { paddingTop: 1, paddingBottom: 1, paddingLeft: 0, paddingRight: 0 },
                "& .MuiStepLabel-root": { paddingLeft: 0, paddingRight: 0 },
                "& .MuiStepIcon-root": { marginRight: "12px !important", marginLeft: 0 },
              }}
            >
              {PHASE_META.map((phase, index) => {
                const status = phaseStatuses[index];
                const isSuccess = status === "success";
                const isFailed = status === "failed";
                const isActive = status === "active";
                return (
                  <Step key={index} completed={isSuccess} error={isFailed}>
                    <StepLabel
                      StepIconComponent={() => {
                        if (isSuccess) {
                          return <CheckCircleIcon sx={{ color: "success.main", fontSize: 28 }} />;
                        }
                        if (isFailed) {
                          return <CancelIcon sx={{ color: "error.main", fontSize: 28 }} />;
                        }
                        if (isActive) {
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
                          fontWeight: isActive ? 600 : 500,
                          color: isSuccess ? "success.main" : isFailed ? "error.main" : undefined,
                        },
                        "& .MuiStepLabel-label.Mui-active": { color: "primary.main", fontWeight: 600 },
                        "& .MuiStepLabel-iconContainer": { paddingRight: 2, paddingLeft: 0 },
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
                );
              })}
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
              {PHASE_META[currentPhase - 1].name} in progress... ({currentPhase}/3)
            </Typography>
          )}
          {currentPhase === 4 && (
            <Typography
              variant="body2"
              sx={{
                color: anyFailed ? "error.main" : "success.main",
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              {anyFailed ? "✗ Analysis completed with errors" : "✓ Analysis completed!"}
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
