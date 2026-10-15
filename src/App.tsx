import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import LeadsPage from "@/pages/LeadsPage";
import LeadDetailPage from "@/pages/LeadDetailPage";
import SchedulePage from "@/pages/SchedulePage";
import Analytics from "@/pages/Analytics";
import AreasPage from "@/pages/AreasPage";
import ActivityLogs from "@/pages/ActivityLogs";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";
import LeadCancellationRequests from "@/pages/LeadCancellationRequests";
import LeadPaymentRequests from "@/pages/LeadPaymentRequests";
import QuotePendingRequests from "@/pages/QuotePendingRequests";
import QuoteApprovalRequests from "@/pages/QuoteApprovalRequests";
import TechnicianChangeApprovals from "@/pages/TechnicianChangeApprovals";
import UrgentReviewRequests from "@/pages/UrgentReviewRequests";
import CxUpdatesPage from "@/pages/CxUpdatesPage";
import TechUpdatesPage from "@/pages/TechUpdatesPage";
import QuoMonitorPage from "@/pages/quo-monitor/QuoMonitorPage";
import AiAssistancePage from "@/pages/ai-assistance/AiAssistancePage";
import CrmUpdates from "@/pages/CrmUpdates";
import MapViewPage from "@/pages/MapViewPage";
import TechniciansPage from "@/pages/TechniciansPage";
import OptimizationPage from "@/pages/OptimizationPage";

const ProcessorBoardPage = lazy(() => import("@/pages/ProcessorBoardPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
    </div>
  );
}

import { useEffect } from "react";
import { setupGlobalRealtime } from "@/lib/realtime";

function ProtectedRoutes() {
  const { fullyAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (fullyAuthenticated) {
      setupGlobalRealtime();
    }
  }, [fullyAuthenticated]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!fullyAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
}

function LoginRoute() {
  const { loading, fullyAuthenticated } = useAuth();

  if (loading) {
    return null;
  }

  if (fullyAuthenticated) {
    return <Navigate to="/leads" replace />;
  }

  return <Login />;
}

function PageRoute({ navItem, children }: { navItem: string; children: ReactNode }) {
  const { canAccess, profileLoaded } = useAuth();

  if (!profileLoaded) {
    return <PageFallback />;
  }

  if (!canAccess(navItem)) {
    return <Navigate to="/leads" replace />;
  }

  return (
    <ErrorBoundary>
      {children}
    </ErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/" element={<ProtectedRoutes />}>
              <Route index element={<Navigate to="/leads" replace />} />
              <Route path="leads" element={<PageRoute navItem="leads"><LeadsPage /></PageRoute>} />
              <Route path="leads/:id" element={<PageRoute navItem="leads"><LeadDetailPage /></PageRoute>} />
              <Route path="schedule" element={<PageRoute navItem="schedule"><SchedulePage /></PageRoute>} />
              <Route path="processor-board" element={<PageRoute navItem="processor_board"><Suspense fallback={<PageFallback />}><ProcessorBoardPage /></Suspense></PageRoute>} />
              <Route path="analytics" element={<PageRoute navItem="analytics"><Analytics /></PageRoute>} />
              <Route path="areas" element={<PageRoute navItem="areas"><AreasPage /></PageRoute>} />
              <Route path="map-view" element={<PageRoute navItem="map_view"><MapViewPage /></PageRoute>} />
              <Route path="technicians" element={<PageRoute navItem="technicians"><TechniciansPage /></PageRoute>} />
        <Route path="optimization" element={<PageRoute navItem="optimization"><OptimizationPage /></PageRoute>} />

              <Route path="activity-logs" element={<PageRoute navItem="activity_logs"><ActivityLogs /></PageRoute>} />
              <Route path="quo-monitor" element={<PageRoute navItem="quo_monitor"><QuoMonitorPage /></PageRoute>} />
              <Route path="quo-dashboard" element={<PageRoute navItem="quo_monitor"><QuoMonitorPage /></PageRoute>} />
              <Route path="ai-assistance" element={<PageRoute navItem="ai_assistance"><AiAssistancePage /></PageRoute>} />
              <Route path="lead-cancellation-requests" element={<PageRoute navItem="cancellation_requests"><LeadCancellationRequests /></PageRoute>} />
              <Route path="lead-payment-requests" element={<PageRoute navItem="payment_requests"><LeadPaymentRequests /></PageRoute>} />
              <Route path="quote-approval" element={<PageRoute navItem="quote_approval_requests"><QuoteApprovalRequests /></PageRoute>} />
              <Route path="quote-pending" element={<PageRoute navItem="quote_pending_requests"><QuotePendingRequests /></PageRoute>} />
      <Route path="tech-approvals" element={<PageRoute navItem="technician_change_requests"><TechnicianChangeApprovals /></PageRoute>} />
      <Route path="urgent-review-requests" element={<PageRoute navItem="urgent_review_requests"><UrgentReviewRequests /></PageRoute>} />
              <Route path="get-cx-update" element={<PageRoute navItem="cx_updates"><CxUpdatesPage /></PageRoute>} />
              <Route path="get-tech-update" element={<PageRoute navItem="cx_updates"><TechUpdatesPage /></PageRoute>} />
              <Route path="crm-updates" element={<PageRoute navItem="crm_updates"><CrmUpdates /></PageRoute>} />
              <Route path="settings" element={<PageRoute navItem="settings"><Settings /></PageRoute>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
