import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import AppSidebar from "@/components/layout/AppSidebar";
import NotificationBell from "@/components/notifications/NotificationBell";
import WorkflowAlerts from "@/components/notifications/WorkflowAlerts";
import HoldJobPopup from "@/components/notifications/HoldJobPopup";
import OperatorWorkflowSync from "@/components/notifications/OperatorWorkflowSync";
import ExtensionUpdateStatus from "@/components/notifications/ExtensionUpdateStatus";
import UrgentLeadPopup from "@/components/notifications/UrgentLeadPopup";
import IncompleteDetailsPopup from "@/components/notifications/IncompleteDetailsPopup";
import { NotificationPopupProvider } from "@/components/notifications/popup-slot";
import JobInProgressPopup from "@/components/notifications/JobInProgressPopup";
import QuoteUpdatedPopup from "@/components/notifications/QuoteUpdatedPopup";
import CrmUpdatePopup from "@/components/notifications/CrmUpdatePopup";
import ThemeToggle from "@/components/ThemeToggle";
import { NotepadProvider, useNotepad } from "@/contexts/NotepadContext";
import FloatingNotepad from "@/components/notepad/FloatingNotepad";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { premiumEase, pageVariants } from "@/lib/motion";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalCommandMenu } from "@/components/layout/GlobalCommandMenu";

function HeaderNotepadTrigger() {
  const { toggleNotepad, activeUserIds, isPickerOpen } = useNotepad();
  const hasActive = activeUserIds.length > 0 || isPickerOpen;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => toggleNotepad()}
      className={`relative h-9 w-9 rounded-xl transition-all duration-200 ${
        hasActive
          ? "bg-primary/15 text-primary border border-primary/20 shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
      title="Open Notepad Manager"
      aria-label="Open notepad manager"
    >
      <FileText className="h-4 w-4" />
      {hasActive && (
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
      )}
    </Button>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const pageMeta: Record<string, { title: string; subtitle: string }> = {
    "/leads": { title: "Leads", subtitle: "Track intake, ownership, and next actions." },
    "/lead-payment-requests": { title: "Payment approvals", subtitle: "Review payment evidence and resolve pending requests." },
    "/quote-approval": { title: "Quote Approval", subtitle: "Review quote requests before they move to the sending queue." },
    "/quote-pending": { title: "Quotes to send", subtitle: "Prioritize and complete customer quotations." },
    "/get-cx-update": { title: "Get CX Update", subtitle: "Request customer follow-ups and review returned CS updates." },
    "/get-tech-update": { title: "Get Tech Update", subtitle: "Request technician details and review Processor replies." },
    "/notifications": { title: "Notifications", subtitle: "Your updates, pending actions, and notification history." },
    "/tech-approvals": { title: "Tech Approvals", subtitle: "Review processor requests to change technician Good Tech or active status." },
    "/lead-cancellation-requests": { title: "Cancellation Requests", subtitle: "Review cancellation reasons and approve or decline requests." },
    "/schedule": { title: "Schedule", subtitle: "Review jobs by day, week, and date range." },
    "/processor-board": { title: "Processor Board", subtitle: "Job-specific technician updates and next actions." },
    "/analytics": { title: "Analytics", subtitle: "Watch volume, pace, and operational trends." },
    "/areas": { title: "Areas", subtitle: "Compare neighborhoods and service performance." },
    "/map-view": { title: "Map View", subtitle: "Match field capacity to nearby customer demand." },
    "/technicians": { title: "Technicians", subtitle: "Manage field coverage, contact details, and specialist availability." },
    "/activity-logs": { title: "Activity", subtitle: "Audit recent actions across the workspace." },
    "/quo-monitor": { title: "QUO Dashboard", subtitle: "Live webhook chats, incoming triage, and lead status management." },
    "/quo-dashboard": { title: "QUO Dashboard", subtitle: "Live webhook chats, incoming triage, and lead status management." },
    "/settings": { title: "Settings", subtitle: "Manage users, permissions, and security controls." },
    "/crm-updates": { title: "CRM Updates", subtitle: "Broadcast one-time live update notifications to selected CRM roles." },
  };

  const activeMeta =
    Object.entries(pageMeta).find(([path]) => location.pathname.startsWith(path))?.[1] ??
    pageMeta["/leads"];
  const isQuoMonitor = location.pathname.startsWith("/quo-monitor") || location.pathname.startsWith("/quo-dashboard");

  return (
    <NotepadProvider>
      <SidebarProvider>
        <GlobalCommandMenu />
        <OperatorWorkflowSync />
        <AppSidebar />
        <SidebarInset className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
            <header className="sticky top-0 z-30 shrink-0 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-6">
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: premiumEase }}
                className="flex items-center gap-3 sm:gap-4"
              >
                <SidebarTrigger aria-label="Toggle navigation" className="rounded-lg hover:bg-accent" />
                <div className="hidden h-4 w-px bg-border/40 sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
                      Marshmallow
                    </span>
                    <span className="hidden rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">
                      Internal workspace
                    </span>
                    <span className="hidden h-1 w-1 rounded-full bg-border/80 sm:block" />
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={activeMeta.title}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: premiumEase }}
                        className="truncate text-sm font-semibold tracking-[-0.02em] text-foreground"
                      >
                        {activeMeta.title}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={activeMeta.subtitle}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="mt-0.5 hidden text-sm text-muted-foreground sm:block"
                    >
                      {activeMeta.subtitle}
                    </motion.p>
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-2">
                  <ExtensionUpdateStatus />
                  <HeaderNotepadTrigger />
                  <ThemeToggle />
                  <NotificationBell />
                </div>
              </motion.div>
            </header>
            <main className="relative flex-1 overflow-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="relative"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          <NotificationPopupProvider>
            <WorkflowAlerts />
            <HoldJobPopup />
            {!isQuoMonitor && <UrgentLeadPopup />}
            {!isQuoMonitor && <JobInProgressPopup />}
            {!isQuoMonitor && <QuoteUpdatedPopup />}
            {!isQuoMonitor && <IncompleteDetailsPopup />}
            <CrmUpdatePopup />
          </NotificationPopupProvider>
          <FloatingNotepad />
        </SidebarInset>
      </SidebarProvider>
    </NotepadProvider>
  );
}
