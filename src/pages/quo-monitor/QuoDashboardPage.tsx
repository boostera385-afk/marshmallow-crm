import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  MessageSquare,
  ChevronDown,
  Calendar,
  Filter,
  PhoneCall,
  RefreshCw,
  Clock,
  Check,
  ExternalLink,
  Copy,
  BarChart3,
  List,
  Sparkles,
  TrendingUp,
  UserCheck,
  XCircle,
  CheckCircle2,
  PhoneIncoming,
  SlidersHorizontal,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { format, isSameDay } from "date-fns";
import { motion } from "framer-motion";
import { premiumEase } from "@/lib/motion";
import {
  formatEasternTime,
  formatUsPhone,
  getEasternDateBounds,
  getQuoChatUrl,
  getQuoNumberName,
  getQuoNumberEmoji,
  normalizeQuoLeadStatus,
  isTechLineNumber,
  QUO_LEAD_STATUS_CONFIG,
  QUO_LEAD_STATUS_KEYS,
  type QuoLeadStatus,
} from "@/lib/quo-dashboard";
import {
  QUO_NUMBER_DISPLAY_SETTING_KEY,
  resolveQuoNumberDisplay,
  type QuoNumberDisplayMap,
} from "@/lib/quo-number-display";
import QuoNumberDisplayDialog from "@/components/quo-dashboard/QuoNumberDisplayDialog";
import QuoChatDialog from "@/components/quo-dashboard/QuoChatDialog";
import ManageNumbersModal from "@/components/quo-dashboard/ManageNumbersModal";
import RenderEmoji from "@/components/common/RenderEmoji";


interface QuoPhoneNumber {
  id: string;
  quo_phone_number_id: string | null;
  number: string;
  name: string | null;
  label: string | null;
  display_number: string | null;
}

interface ConversationRow {
  id: string;
  quo_conversation_id: string;
  customer_name: string | null;
  customer_number: string | null;
  number_id: string | null;
  last_message_preview: string | null;
  last_message_time: string | null;
  last_message_at: string | null;
  created_at: string;
  status: string | null;
  current_status?: string | null;
  quo_phone_numbers?: QuoPhoneNumber | null;
}

type DateRangePreset = "all" | "today" | "yesterday" | "last7" | "month" | "custom";

export default function QuoDashboardPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"table" | "analytics">("table");
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedNumberIds, setSelectedNumberIds] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DateRangePreset>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [activeChatConversation, setActiveChatConversation] = useState<ConversationRow | null>(null);
  const [manageNumbersOpen, setManageNumbersOpen] = useState(false);
  const [showHiddenNumbers, setShowHiddenNumbers] = useState(false);

  // Fetch QUO Number Preferences
  const { data: numberPreferences = [], refetch: refetchPreferences } = useQuery({
    queryKey: ["quo-number-preferences"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quo_number_preferences").select("*");
      if (error) {
        console.warn("Could not load quo_number_preferences:", error.message);
        return [];
      }
      return data || [];
    },
  });

  const preferencesMap = useMemo(() => {
    const map: Record<string, { phone_number_id: string; hidden: boolean; sort_order: number; label_override?: string | null; emoji?: string | null }> = {};
    numberPreferences.forEach((pref) => {
      if (pref.phone_number_id) {
        map[pref.phone_number_id] = pref;
      }
    });
    return map;
  }, [numberPreferences]);

  const hiddenNumberIds = useMemo(() => {
    const set = new Set<string>();
    Object.entries(preferencesMap).forEach(([numId, pref]) => {
      if (pref.hidden) set.add(numId);
    });
    return set;
  }, [preferencesMap]);

  // Column-header filters
  const [numberNameFilter, setNumberNameFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [timeSort, setTimeSort] = useState<"desc" | "asc">("desc");

  const [currentPage, setCurrentPage] = useState(1);

  // Custom number display names / emojis (stored in quo_ai_settings)
  const { data: numberDisplayMap = {} } = useQuery<QuoNumberDisplayMap>({
    queryKey: ["quo-number-display-map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_ai_settings")
        .select("value")
        .eq("key", QUO_NUMBER_DISPLAY_SETTING_KEY)
        .maybeSingle();
      if (error) return {};
      const value = data?.value;
      return value && typeof value === "object" ? (value as QuoNumberDisplayMap) : {};
    },
  });

  const saveDisplayMapMutation = useMutation({
    mutationFn: async (map: QuoNumberDisplayMap) => {
      const cleaned: QuoNumberDisplayMap = {};
      Object.entries(map).forEach(([id, entry]) => {
        const label = (entry?.label || "").trim();
        const emoji = (entry?.emoji || "").trim();
        if (label || emoji) cleaned[id] = { ...(label ? { label } : {}), ...(emoji ? { emoji } : {}) };
      });
      const { error } = await supabase.from("quo_ai_settings").upsert(
        {
          key: QUO_NUMBER_DISPLAY_SETTING_KEY,
          value: cleaned as unknown as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );
      if (error) throw error;
      return cleaned;
    },
    onSuccess: (cleaned) => {
      queryClient.setQueryData(["quo-number-display-map"], cleaned);
      setManageNumbersOpen(false);
      toast.success("Number names updated");
    },
    onError: (err: Error) => toast.error(`Failed to save names: ${err.message}`),
  });



  // Fetch QUO Phone Numbers list
  const { data: phoneNumbers = [] } = useQuery<QuoPhoneNumber[]>({
    queryKey: ["quo-phone-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_phone_numbers")
        .select("id, quo_phone_number_id, number, name, label, display_number")
        .order("name", { ascending: true });

      if (error) {
        console.error("Failed to load QUO phone numbers", error);
        return [];
      }
      const list = (data as QuoPhoneNumber[]) ?? [];
      return list.filter((p) => !isTechLineNumber(p.number || p.display_number || p.name));
    },
  });

  // Fetch Conversations list
    const {
    data: queryData = { data: [], count: 0 },
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [
      "quo-dashboard-conversations",
      currentPage,
      search,
      selectedStatus,
      selectedNumberIds,
      datePreset,
      startDate,
      endDate,
      numberNameFilter,
      customerFilter,
      timeSort,
      showHiddenNumbers,
      phoneNumbers.length,
      hiddenNumberIds.size
    ],
    queryFn: async () => {
      try {
        let query = supabase
          .from("quo_conversations")
          .select("id, quo_conversation_id, customer_name, customer_number, number_id, last_message_preview, last_message_time, last_message_at, created_at, status, current_status", { count: "exact" });

        // 1. Search Filter
        if (search.trim()) {
          const q = `%${search.trim()}%`;
          query = query.or(`customer_name.ilike.${q},customer_number.ilike.${q},last_message_preview.ilike.${q}`);
        }

        // 1b. Customer Filter
        if (customerFilter.trim()) {
          const cq = `%${customerFilter.trim()}%`;
          const digits = customerFilter.replace(/\D/g, "");
          if (digits) {
            query = query.or(`customer_name.ilike.${cq},customer_number.ilike.%${digits}%`);
          } else {
             query = query.or(`customer_name.ilike.${cq},customer_number.ilike.${cq}`);
          }
        }

        // 2. Status Filter
        if (selectedStatus !== "all") {
          if (selectedStatus === "unresponded") {
            query = query.or("status.eq.needs_reply,current_status.eq.needs_reply");
          } else {
            query = query.or(`status.eq.${selectedStatus},current_status.eq.${selectedStatus}`);
          }
        }

        // 3. Numbers Filter
        let filteredPhones = phoneNumbers.filter(p => !isTechLineNumber(p.number || p.display_number || p.name));

        if (!showHiddenNumbers) {
          filteredPhones = filteredPhones.filter(p => !hiddenNumberIds.has(p.id));
        }
        if (selectedNumberIds.length > 0) {
          const selectedSet = new Set(selectedNumberIds);
          filteredPhones = filteredPhones.filter(p => selectedSet.has(p.id));
        }
        if (numberNameFilter.trim()) {
          const lowerF = numberNameFilter.toLowerCase().trim();
          filteredPhones = filteredPhones.filter(p => {
             const name = resolveQuoNumberDisplay(p, numberDisplayMap).name.toLowerCase();
             return name.includes(lowerF);
          });
        }

        const matchingIds = filteredPhones.map(p => p.id);
        if (matchingIds.length > 0) {
          query = query.in("number_id", matchingIds);
        } else {
          return { data: [], count: 0 };
        }

        // 4. Date Filter
        if (datePreset !== "all") {
           let s = null;
           let e = null;
           
           if (datePreset === "today") {
             const todayNYStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
             s = getEasternDateBounds(todayNYStr, "start");
             e = getEasternDateBounds(todayNYStr, "end");
           } else if (datePreset === "yesterday") {
             const y = new Date(); y.setDate(y.getDate() - 1);
             const yNY = y.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
             s = getEasternDateBounds(yNY, "start");
             e = getEasternDateBounds(yNY, "end");
           } else if (datePreset === "last7") {
             const d7 = new Date(); d7.setDate(d7.getDate() - 7);
             const d7Str = d7.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
             s = getEasternDateBounds(d7Str, "start");
           } else if (datePreset === "custom") {
             if (startDate) s = getEasternDateBounds(startDate, "start");
             if (endDate) e = getEasternDateBounds(endDate, "end");
           }

           if (s) query = query.gte("created_at", s.toISOString());
           if (e) query = query.lte("created_at", e.toISOString());
        }

        const from = (currentPage - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);
        
        query = query.order("created_at", { ascending: timeSort === "asc" });
        query = query.order("id", { ascending: false });

        const { data, count, error } = await query;
        if (error) throw error;

        return { data: data, count: count || 0 };
      } catch (error) {
        console.error("Conversation fetch failed:", error);
        return { data: [], count: 0 };
      }
    },
    refetchInterval: 60000,
  });

  const rawConversations = queryData.data;
  const totalCount = queryData.count;

  useEffect(() => {
    const channel = supabase
      .channel("quo-dashboard-conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quo_conversations" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["quo-dashboard-conversations"] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const conversations = useMemo(() => {
    const numbersById = new Map(phoneNumbers.map((number) => [number.id, number]));
    return rawConversations.map((conversation) => ({
      ...conversation,
      quo_phone_numbers: conversation.number_id
        ? numbersById.get(conversation.number_id) ?? null
        : null,
    }));
  }, [phoneNumbers, rawConversations]);

  const PAGE_SIZE = 100;
// Mutation to update conversation Lead Status
  const updateStatusMutation = useMutation({
    mutationFn: async ({
      conversationId,
      newStatus,
    }: {
      conversationId: string;
      newStatus: QuoLeadStatus;
    }) => {
      const { error } = await supabase
        .from("quo_conversations")
        .update({
          status: newStatus,
          current_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quo-dashboard-conversations"] });
      toast.success(`Lead status updated to ${QUO_LEAD_STATUS_CONFIG[variables.newStatus].label}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to update status: ${err.message}`);
    },
  });

  // Query Webhook Ingestion Paused Setting
  const { data: isWebhookPaused = false, refetch: refetchWebhookSetting } = useQuery<boolean>({
    queryKey: ["quo-webhook-paused-setting"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quo_ai_settings")
        .select("value")
        .eq("key", "quo_webhook_ingestion_paused")
        .maybeSingle();

      if (error) return false;
      return data?.value === true;
    },
  });

  // Mutation to toggle Webhook Ingestion Paused state
  const toggleWebhookMutation = useMutation({
    mutationFn: async (shouldPause: boolean) => {
      const { error } = await supabase
        .from("quo_ai_settings")
        .upsert(
          {
            key: "quo_webhook_ingestion_paused",
            value: shouldPause,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (error) throw error;
    },
    onSuccess: (_, shouldPause) => {
      refetchWebhookSetting();
      toast.success(
        shouldPause
          ? "QUO Webhook ingestion paused"
          : "QUO Webhook ingestion activated! Now receiving new messages."
      );
    },
    onError: (err: Error) => {
      toast.error(`Failed to toggle webhook setting: ${err.message}`);
    },
  });

  // Toggle selection for QUO Phone Numbers filter
  const handleToggleNumber = (id: string) => {
    setSelectedNumberIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllNumbers = () => {
    if (selectedNumberIds.length === phoneNumbers.length) {
      setSelectedNumberIds([]);
    } else {
      setSelectedNumberIds(phoneNumbers.map((n) => n.id));
    }
  };


  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const paginatedConversations = conversations;

  // Analytics Computation
  const analyticsData = useMemo(() => {
    const total = totalCount;
    const statusCounts: Record<QuoLeadStatus, number> = {
      raw: 0,
      spam: 0,
      contacted: 0,
      qualified_lead: 0,
      rejected: 0,
      successfully_completed: 0,
    };

    const byNumberMap: Record<
      string,
      {
        numberId: string;
        name: string;
        emoji: string;

        phone: string;
        total: number;
        statusCounts: Record<QuoLeadStatus, number>;
      }
    > = {};

    conversations.forEach((conv) => {
      const st = normalizeQuoLeadStatus(conv.status || conv.current_status);
      statusCounts[st] = (statusCounts[st] || 0) + 1;

      const numId = conv.number_id || "unknown";
      const numberObj = conv.quo_phone_numbers;
      const numDisp = resolveQuoNumberDisplay(numberObj, numberDisplayMap);
      const numPhone = numberObj?.number || "No number";

      if (!byNumberMap[numId]) {
        byNumberMap[numId] = {
          numberId: numId,
          name: numDisp.name,
          emoji: numDisp.emoji,
          phone: numPhone,
          total: 0,
          statusCounts: {
            raw: 0,
            spam: 0,
            contacted: 0,
            qualified_lead: 0,
            rejected: 0,
            successfully_completed: 0,
          },
        };
      }

      byNumberMap[numId].total += 1;
      byNumberMap[numId].statusCounts[st] += 1;
    });

    const perNumberList = Object.values(byNumberMap).sort((a, b) => b.total - a.total);

    return {
      total,
      statusCounts,
      perNumberList,
    };
  }, [conversations, numberDisplayMap]);

  // Chat counts per QUO number (for the manage-numbers dialog)
  const chatCountsByNumberId = useMemo(() => {
    const counts: Record<string, number> = {};
    conversations.forEach((c) => {
      if (c.number_id) counts[c.number_id] = (counts[c.number_id] || 0) + 1;
    });
    return counts;
  }, [conversations]);

  const handleCopyChatUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("QUO chat link copied to clipboard");
  };


  return (
    <div className="mx-auto max-w-[1600px] space-y-6 pb-12">
      {/* Top Hero Section */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: premiumEase }}
        className="glass-panel-strong relative overflow-hidden rounded-[28px] px-5 py-5 shadow-[0_38px_82px_-42px_rgba(59,130,246,0.28)] sm:px-6 sm:py-6"
      >
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.6)]" />
              QUO Webhook Triage
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.04em] text-foreground">
              QUO Dashboard
            </h1>
            <p className="mt-1 max-w-2xl text-xs sm:text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span>Live incoming webhook chats, analytics breakdown, and lead status management strictly in</span>
              <Badge variant="secondary" className="font-semibold text-foreground text-[11px] px-2 py-0 border-primary/20">
                Eastern Time Zone (US/Eastern)
              </Badge>
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Webhook Status Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleWebhookMutation.mutate(!isWebhookPaused)}
              className={`gap-1.5 text-xs h-9 font-medium border transition-all ${
                isWebhookPaused
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 hover:bg-amber-100"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 hover:bg-emerald-100"
              }`}
              title="Toggle Webhook Message Ingestion"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isWebhookPaused ? "bg-amber-500 animate-pulse" : "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                }`}
              />
              <span>{isWebhookPaused ? "Webhook Paused" : "Webhook Active"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="gap-2 text-xs h-9 bg-background/80"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin text-primary" : ""}`} />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setManageNumbersOpen(true)}
              className="gap-2 text-xs h-9 bg-background/80 border-border/80 hover:bg-muted/50 font-medium"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
              <span>Manage numbers</span>
            </Button>
          </div>
        </div>
      </motion.section>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "table" | "analytics")}>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
          <TabsList className="bg-muted/40 p-1 border border-border/50 rounded-xl">
            <TabsTrigger value="table" className="gap-2 text-xs px-4 py-1.5 font-medium">
              <List className="h-4 w-4" />
              <span>Triage Table</span>
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {totalCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2 text-xs px-4 py-1.5 font-medium">
              <BarChart3 className="h-4 w-4" />
              <span>Analytics & Metrics</span>
            </TabsTrigger>
          </TabsList>

          {/* Filter Control Bar */}
          <div className="glass-panel-strong rounded-2xl p-2 px-3 flex flex-wrap items-center gap-2 border border-border/60">
            {/* Search (for table tab) */}
            {activeTab === "table" && (
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="pl-8 h-8 text-xs bg-background/80"
                />
              </div>
            )}

            {/* Show/Hide Hidden Numbers Toggle */}
            {hiddenNumberIds.size > 0 && (
              <Button
                variant={showHiddenNumbers ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowHiddenNumbers(!showHiddenNumbers)}
                className="h-8 gap-1.5 text-xs border-border/70 bg-background/80"
              >
                {showHiddenNumbers ? (
                  <>
                    <Eye className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Showing {hiddenNumberIds.size} Hidden</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5 text-rose-400" />
                    <span>{hiddenNumberIds.size} Hidden</span>
                  </>
                )}
              </Button>
            )}

            {/* QUO Numbers Selector Filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
                  <PhoneCall className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {selectedNumberIds.length === 0
                      ? "All Numbers"
                      : selectedNumberIds.length === phoneNumbers.length
                      ? "All Numbers"
                      : `${selectedNumberIds.length} Number${selectedNumberIds.length > 1 ? "s" : ""}`}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[260px] p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-xs font-semibold text-foreground">Select QUO Numbers</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAllNumbers}
                      className="h-6 text-[10px] px-2 text-primary"
                    >
                      {selectedNumberIds.length === phoneNumbers.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pt-1">
                    {phoneNumbers.map((num) => {
                      const isChecked = selectedNumberIds.includes(num.id);
                      const numDisp = resolveQuoNumberDisplay(num, numberDisplayMap);

                      return (
                        <div
                          key={num.id}
                          onClick={() => handleToggleNumber(num.id)}
                          className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/40 cursor-pointer text-xs select-none"
                        >
                          <Checkbox checked={isChecked} onCheckedChange={() => handleToggleNumber(num.id)} />
                          <RenderEmoji emoji={numDisp.emoji} size="sm" />
                          <span className="truncate font-medium text-foreground">{numDisp.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Lead Status Filter */}
            {activeTab === "table" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
                    <Filter className="h-3.5 w-3.5 text-primary" />
                    <span className="capitalize">
                      {selectedStatus === "all"
                        ? "All Statuses"
                        : QUO_LEAD_STATUS_CONFIG[selectedStatus as QuoLeadStatus]?.label || selectedStatus}
                    </span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  <DropdownMenuItem onClick={() => setSelectedStatus("all")} className="text-xs">
                    All Statuses
                  </DropdownMenuItem>
                  {QUO_LEAD_STATUS_KEYS.map((key) => {
                    const cfg = QUO_LEAD_STATUS_CONFIG[key];
                    return (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => setSelectedStatus(key)}
                        className="text-xs flex items-center justify-between"
                      >
                        <span>{cfg.label}</span>
                        {selectedStatus === key && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Date Range Selector (Strictly Eastern Time) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border/70 bg-background/80">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  <span>
                    {datePreset === "all"
                      ? "All Dates (ET)"
                      : datePreset === "today"
                      ? "Today (ET)"
                      : datePreset === "yesterday"
                      ? "Yesterday (ET)"
                      : datePreset === "last7"
                      ? "Last 7 Days (ET)"
                      : "Custom Range (ET)"}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[310px] p-4 space-y-3">
                <div className="text-xs font-semibold text-foreground border-b pb-2 flex items-center justify-between">
                  <span>Date Range Filter</span>
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    Eastern Time (ET)
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant={datePreset === "all" ? "default" : "outline"}
                    onClick={() => setDatePreset("all")}
                    className="h-7 text-xs"
                  >
                    All Dates
                  </Button>
                  <Button
                    size="sm"
                    variant={datePreset === "today" ? "default" : "outline"}
                    onClick={() => setDatePreset("today")}
                    className="h-7 text-xs"
                  >
                    Today (ET)
                  </Button>
                  <Button
                    size="sm"
                    variant={datePreset === "yesterday" ? "default" : "outline"}
                    onClick={() => setDatePreset("yesterday")}
                    className="h-7 text-xs"
                  >
                    Yesterday (ET)
                  </Button>
                  <Button
                    size="sm"
                    variant={datePreset === "last7" ? "default" : "outline"}
                    onClick={() => setDatePreset("last7")}
                    className="h-7 text-xs"
                  >
                    Last 7 Days (ET)
                  </Button>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Custom Date Range (Eastern Time):
                  </span>
                  <div className="space-y-1.5">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Start Date</Label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value);
                          setDatePreset("custom");
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">End Date</Label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value);
                          setDatePreset("custom");
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Tab 1: Table View */}
        <TabsContent value="table" className="mt-0">
          <div className="glass-panel-strong rounded-2xl border border-border/60 overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[60px] text-center font-semibold text-xs text-foreground">
                    #
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <span>Number Name</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 ${numberNameFilter || selectedNumberIds.length ? "text-primary" : "text-muted-foreground"}`}
                            title="Filter by number name"
                          >
                            <Filter className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[260px] p-3 space-y-2">
                          <Label className="text-[11px] text-muted-foreground">Filter number name</Label>
                          <Input
                            value={numberNameFilter}
                            onChange={(e) => setNumberNameFilter(e.target.value)}
                            placeholder="e.g. Dallas"
                            className="h-8 text-xs"
                          />
                          <div className="max-h-40 space-y-1 overflow-y-auto border-t pt-2">
                            {phoneNumbers.map((num) => (
                              <div
                                key={num.id}
                                onClick={() => handleToggleNumber(num.id)}
                                className="flex cursor-pointer select-none items-center gap-2 rounded-lg p-1.5 text-xs hover:bg-muted/40"
                              >
                                <Checkbox checked={selectedNumberIds.includes(num.id)} />
                                <span className="truncate">
                                  {resolveQuoNumberDisplay(num, numberDisplayMap).full}
                                </span>
                              </div>
                            ))}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-xs"
                            onClick={() => {
                              setNumberNameFilter("");
                              setSelectedNumberIds([]);
                            }}
                          >
                            Clear
                          </Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <span>Customer Number</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 ${customerFilter ? "text-primary" : "text-muted-foreground"}`}
                            title="Filter customer"
                          >
                            <Filter className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[240px] p-3 space-y-2">
                          <Label className="text-[11px] text-muted-foreground">Name or phone</Label>
                          <Input
                            value={customerFilter}
                            onChange={(e) => setCustomerFilter(e.target.value)}
                            placeholder="Search customer..."
                            className="h-8 text-xs"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-xs"
                            onClick={() => setCustomerFilter("")}
                          >
                            Clear
                          </Button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground w-[120px]">
                    Chat
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTimeSort((p) => (p === "desc" ? "asc" : "desc"))}
                      className="h-6 gap-1 px-1 text-xs font-semibold text-foreground"
                      title="Sort by incoming time"
                    >
                      <span>Incoming time (ET)</span>
                      <ChevronDown
                        className={`h-3 w-3 text-muted-foreground transition-transform ${
                          timeSort === "asc" ? "rotate-180" : ""
                        }`}
                      />
                    </Button>
                  </TableHead>
                  <TableHead className="font-semibold text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <span>Lead Status</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 ${selectedStatus !== "all" ? "text-primary" : "text-muted-foreground"}`}
                            title="Filter by lead status"
                          >
                            <Filter className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[200px]">
                          <DropdownMenuItem onClick={() => setSelectedStatus("all")} className="text-xs">
                            All Statuses
                          </DropdownMenuItem>
                          {QUO_LEAD_STATUS_KEYS.map((key) => (
                            <DropdownMenuItem
                              key={key}
                              onClick={() => setSelectedStatus(key)}
                              className="flex items-center justify-between text-xs"
                            >
                              <span>{QUO_LEAD_STATUS_CONFIG[key].label}</span>
                              {selectedStatus === key && <Check className="h-3.5 w-3.5 text-primary" />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableHead>

                  <TableHead className="font-semibold text-xs text-foreground text-right w-[160px]">
                    Quo Chat Link
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-center"><Skeleton className="h-4 w-4 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-7 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : totalCount === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40 text-center text-muted-foreground text-xs">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                        <span>No conversations found matching filters</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedConversations.map((row, index) => {
                    const numberDisp = resolveQuoNumberDisplay(row.quo_phone_numbers, numberDisplayMap);

                    const normStatusKey = normalizeQuoLeadStatus(row.status || row.current_status);
                    const statusCfg = QUO_LEAD_STATUS_CONFIG[normStatusKey];
                    const incomingTimeDisplay = formatEasternTime(
                      row.created_at || row.last_message_at || row.last_message_time,
                      "time"
                    );

                    const pncId = row.quo_phone_numbers?.quo_phone_number_id || undefined;
                    const quoChatUrl = getQuoChatUrl(row.quo_conversation_id, row.customer_number, pncId);

                    return (
                      <TableRow
                        key={row.id}
                        className="hover:bg-muted/30 transition-colors duration-150 border-b border-border/40"
                      >
                        {/* Column 1: # / Chat # */}
                        <TableCell className="text-center font-mono text-xs text-muted-foreground font-semibold">
                          {(currentPage - 1) * PAGE_SIZE + index + 1}
                        </TableCell>

                        {/* Column 2: Number Name */}
                        <TableCell className="font-medium text-xs text-foreground">
                          <div className="flex items-center gap-2">
                            <RenderEmoji emoji={numberDisp.emoji} size="sm" />
                            <span className="truncate">{numberDisp.name}</span>
                          </div>
                        </TableCell>

                        {/* Column 3: Customer Number */}
                        <TableCell className="font-medium text-xs text-foreground font-mono">
                          {formatUsPhone(row.customer_number)}
                          {row.customer_name && (
                            <span className="text-[11px] font-sans font-normal text-muted-foreground block">
                              {row.customer_name}
                            </span>
                          )}
                        </TableCell>

                        {/* Column 4: Chat (Open Button) */}
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveChatConversation(row)}
                            className="h-7 px-3 text-xs gap-1.5 border-border/70 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-primary" />
                            <span>Open</span>
                          </Button>
                        </TableCell>

                        {/* Column 5: Incoming time (Eastern Time) */}
                        <TableCell className="text-xs text-foreground font-mono">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{incomingTimeDisplay}</span>
                          </div>
                        </TableCell>

                        {/* Column 6: Lead Status (Interactive Dropdown) */}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-2.5 rounded-lg border text-xs font-medium gap-1.5 transition-all ${statusCfg.badgeClass}`}
                              >
                                <span>{statusCfg.label}</span>
                                <ChevronDown className="h-3 w-3 opacity-60" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-[210px] p-1">
                              {QUO_LEAD_STATUS_KEYS.map((statusKey) => {
                                const optionCfg = QUO_LEAD_STATUS_CONFIG[statusKey];
                                const isSelected = normStatusKey === statusKey;

                                return (
                                  <DropdownMenuItem
                                    key={statusKey}
                                    onClick={() =>
                                      updateStatusMutation.mutate({
                                        conversationId: row.id,
                                        newStatus: statusKey,
                                      })
                                    }
                                    className="text-xs p-2 flex items-center justify-between cursor-pointer"
                                  >
                                    <div className="flex flex-col">
                                      <span className="font-medium">{optionCfg.label}</span>
                                      <span className="text-[10px] text-muted-foreground leading-tight">
                                        {optionCfg.description}
                                      </span>
                                    </div>
                                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-1" />}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>

                        {/* Column 7: Quo Chat Link */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={quoChatUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center"
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
                                title="Open QUO Chat Link in new tab"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span>Quo Chat Link</span>
                              </Button>
                            </a>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleCopyChatUrl(quoChatUrl)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Copy chat link"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* Footer Summary */}
            <div className="p-3 border-t border-border/40 bg-muted/20 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>
                  Showing <strong className="text-foreground">{totalCount > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0}</strong>-
                  <strong className="text-foreground">{Math.min(currentPage * PAGE_SIZE, totalCount)}</strong> of{" "}
                  <strong className="text-foreground">{totalCount}</strong> matching (Total: {totalCount})
                </span>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <span className="px-2 font-medium">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
              <span className="text-[11px] font-mono hidden sm:inline-block">Timezone: Eastern Time Zone (US/Eastern)</span>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Analytics & Breakdown View */}
        <TabsContent value="analytics" className="mt-0 space-y-6">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-muted-foreground">Total Leads</span>
                <span className="text-2xl font-bold text-foreground mt-1">{analyticsData.total}</span>
              </CardContent>
            </Card>

            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Raw Leads</span>
                <span className="text-2xl font-bold text-slate-700 dark:text-slate-200 mt-1">
                  {analyticsData.statusCounts.raw}
                </span>
              </CardContent>
            </Card>

            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Contacted</span>
                <span className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">
                  {analyticsData.statusCounts.contacted}
                </span>
              </CardContent>
            </Card>

            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Qualified Leads</span>
                <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                  {analyticsData.statusCounts.qualified_lead}
                </span>
              </CardContent>
            </Card>

            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Completed</span>
                <span className="text-2xl font-bold text-teal-700 dark:text-teal-300 mt-1">
                  {analyticsData.statusCounts.successfully_completed}
                </span>
              </CardContent>
            </Card>

            <Card className="glass-panel-strong border-border/60">
              <CardContent className="p-4 flex flex-col">
                <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Rejected / Spam</span>
                <span className="text-2xl font-bold text-rose-700 dark:text-rose-300 mt-1">
                  {analyticsData.statusCounts.rejected + analyticsData.statusCounts.spam}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown by QUO Phone Number */}
          <Card className="glass-panel-strong border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                  <PhoneIncoming className="h-4 w-4 text-primary" />
                  <span>Leads Breakdown by QUO Phone Number</span>
                </CardTitle>
                <Badge variant="outline" className="text-xs font-mono">
                  Eastern Time (ET) Filtered
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-foreground">QUO Number Name</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground">Phone Number</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Total Leads</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Raw</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Contacted</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Qualified</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Completed</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-center">Rejected / Spam</TableHead>
                    <TableHead className="text-xs font-semibold text-foreground text-right">Qual. Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analyticsData.perNumberList.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-32 text-center text-xs text-muted-foreground">
                        No conversations found in selected date range / filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    analyticsData.perNumberList.map((item) => {
                      const qualCount = item.statusCounts.qualified_lead + item.statusCounts.successfully_completed;
                      const qualRate = item.total > 0 ? Math.round((qualCount / item.total) * 100) : 0;

                      return (
                        <TableRow key={item.numberId} className="hover:bg-muted/30">
                          <TableCell className="font-medium text-xs text-foreground">
                            <div className="flex items-center gap-2">
                              <RenderEmoji emoji={item.emoji} size="sm" />
                              <span>{item.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {formatUsPhone(item.phone)}
                          </TableCell>
                          <TableCell className="text-center font-semibold text-xs text-foreground">
                            {item.total}
                          </TableCell>
                          <TableCell className="text-center text-xs">{item.statusCounts.raw}</TableCell>
                          <TableCell className="text-center text-xs text-blue-600 font-medium">
                            {item.statusCounts.contacted}
                          </TableCell>
                          <TableCell className="text-center text-xs text-emerald-600 font-semibold">
                            {item.statusCounts.qualified_lead}
                          </TableCell>
                          <TableCell className="text-center text-xs text-teal-600 font-semibold">
                            {item.statusCounts.successfully_completed}
                          </TableCell>
                          <TableCell className="text-center text-xs text-rose-600">
                            {item.statusCounts.rejected + item.statusCounts.spam}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-primary font-mono">
                            {qualRate}%
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Lead Status Distribution Progress */}
          <Card className="glass-panel-strong border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
              <CardTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span>Overall Lead Status Distribution</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {QUO_LEAD_STATUS_KEYS.map((key) => {
                const cfg = QUO_LEAD_STATUS_CONFIG[key];
                const count = analyticsData.statusCounts[key] || 0;
                const pct = analyticsData.total > 0 ? Math.round((count / analyticsData.total) * 100) : 0;

                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-[11px] font-semibold ${cfg.badgeClass}`}>
                          {cfg.label}
                        </Badge>
                        <span className="text-muted-foreground hidden sm:inline">{cfg.description}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="font-semibold text-foreground">{count}</span>
                        <span className="text-muted-foreground">({pct}%)</span>
                      </div>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manage QUO number display names + emojis */}
      <QuoNumberDisplayDialog
        open={manageNumbersOpen}
        onOpenChange={setManageNumbersOpen}
        numbers={phoneNumbers.map((n) => ({ ...n, chatCount: chatCountsByNumberId[n.id] || 0 }))}
        displayMap={numberDisplayMap}
        isSaving={saveDisplayMapMutation.isPending}
        onSave={(map) => saveDisplayMapMutation.mutate(map)}
      />

      {/* Webhook Chat Drawer UI Box */}
      <QuoChatDialog
        open={!!activeChatConversation}
        onOpenChange={(open) => !open && setActiveChatConversation(null)}
        conversation={
          activeChatConversation
            ? {
                id: activeChatConversation.id,
                customer_name: activeChatConversation.customer_name,
                customer_number: activeChatConversation.customer_number,
                number_name: resolveQuoNumberDisplay(activeChatConversation.quo_phone_numbers, numberDisplayMap).full,
                status: activeChatConversation.status,
              }
            : null
        }
        onStatusChange={(newStatus) => {
          if (activeChatConversation) {
            updateStatusMutation.mutate({
              conversationId: activeChatConversation.id,
              newStatus,
            });
          }
        }}
      />

      {/* Manage Numbers Modal */}
      <ManageNumbersModal
        open={manageNumbersOpen}
        onOpenChange={setManageNumbersOpen}
        phoneNumbers={phoneNumbers}
        conversations={conversations}
        preferences={preferencesMap}
        onPreferencesUpdated={() => {
          refetchPreferences();
          queryClient.invalidateQueries({ queryKey: ["quo-phone-numbers"] });
          queryClient.invalidateQueries({ queryKey: ["quo-dashboard-conversations"] });
        }}
      />
    </div>
  );
}
