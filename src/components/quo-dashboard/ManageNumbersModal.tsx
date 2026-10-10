import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Search,
  Heart,
  SlidersHorizontal,
  Sparkles,
  RotateCcw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getQuoNumberName, getQuoNumberEmoji, formatUsPhone } from "@/lib/quo-dashboard";
import RenderEmoji from "@/components/common/RenderEmoji";

export interface QuoNumberPrefItem {
  phone_number_id: string; // UUID from quo_phone_numbers
  label_override?: string | null;
  emoji?: string | null;
  hidden: boolean;
  sort_order: number;
}

export interface QuoPhoneNumberObj {
  id: string;
  quo_phone_number_id?: string;
  number: string;
  name?: string | null;
  label?: string | null;
  display_number?: string | null;
}

interface ManageNumbersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumbers: QuoPhoneNumberObj[];
  conversations?: Array<{ number_id?: string | null; quo_phone_numbers?: { id: string } | null }>;
  preferences: Record<string, QuoNumberPrefItem>;
  onPreferencesUpdated: () => void;
}

export default function ManageNumbersModal({
  open,
  onOpenChange,
  phoneNumbers,
  conversations = [],
  preferences,
  onPreferencesUpdated,
}: ManageNumbersModalProps) {
  const [search, setSearch] = useState("");
  const [localList, setLocalList] = useState<
    Array<{
      id: string;
      number: string;
      originalName: string;
      displayName: string;
      hidden: boolean;
      sortOrder: number;
      chatCount: number;
      emoji: string;
    }>
  >([]);
  const [saving, setSaving] = useState(false);

  // Compute conversation counts by number_id
  const chatCountsMap = useMemo(() => {
    const map: Record<string, number> = {};
    conversations.forEach((c) => {
      const numId = c.number_id || c.quo_phone_numbers?.id;
      if (numId) {
        map[numId] = (map[numId] || 0) + 1;
      }
    });
    return map;
  }, [conversations]);

  // Sync state when modal opens or phoneNumbers / preferences change
  useEffect(() => {
    if (!open) return;

    const list = phoneNumbers.map((num, idx) => {
      const pref = preferences[num.id];
      const baseName = getQuoNumberName(num);
      const displayName = pref?.label_override || baseName;
      const hidden = pref?.hidden ?? false;
      const sortOrder = pref?.sort_order ?? idx;
      const chatCount = chatCountsMap[num.id] || 0;
      const emoji = getQuoNumberEmoji({ emoji: pref?.emoji, number: num.number }, num.number);

      return {
        id: num.id,
        number: num.number,
        originalName: baseName,
        displayName,
        hidden,
        sortOrder,
        chatCount,
        emoji,
      };
    });

    // Sort by sortOrder
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    setLocalList(list);
  }, [open, phoneNumbers, preferences, chatCountsMap]);

  // Filtered list by search
  const filteredList = useMemo(() => {
    if (!search.trim()) return localList;
    const q = search.toLowerCase();
    return localList.filter(
      (item) =>
        item.displayName.toLowerCase().includes(q) ||
        item.number.toLowerCase().includes(q) ||
        item.originalName.toLowerCase().includes(q)
    );
  }, [localList, search]);

  // Toggle Hide / Show for a number
  const handleToggleHide = async (id: string) => {
    const updated = localList.map((item) => {
      if (item.id === id) {
        return { ...item, hidden: !item.hidden };
      }
      return item;
    });

    setLocalList(updated);
    const targetItem = updated.find((i) => i.id === id);

    if (targetItem) {
      await saveSinglePref(targetItem);
    }
  };

  // Move item Up or Down
  const handleMove = async (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === localList.length - 1) return;

    const targetIdx = direction === "up" ? index - 1 : index + 1;
    const newList = [...localList];
    const temp = newList[index];
    newList[index] = newList[targetIdx];
    newList[targetIdx] = temp;

    // Update sortOrder values
    const reordered = newList.map((item, idx) => ({ ...item, sortOrder: idx }));
    setLocalList(reordered);
    await saveAllPrefs(reordered);
  };

  // Name change handler
  const handleNameChange = (id: string, newName: string) => {
    setLocalList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, displayName: newName } : item))
    );
  };

  // Save single item preference to Supabase
  const saveSinglePref = async (item: {
    id: string;
    displayName: string;
    hidden: boolean;
    sortOrder: number;
    emoji: string;
  }) => {
    try {
      // 1. Upsert quo_number_preferences
      const { error: prefError } = await supabase
        .from("quo_number_preferences")
        .upsert(
          {
            phone_number_id: item.id,
            label_override: item.displayName,
            emoji: item.emoji,
            hidden: item.hidden,
            sort_order: item.sortOrder,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "phone_number_id" }
        );

      if (prefError) {
        console.warn("Could not upsert quo_number_preferences:", prefError.message);
      }

      // 2. Also update quo_phone_numbers name if changed
      await supabase
        .from("quo_phone_numbers")
        .update({ name: item.displayName, updated_at: new Date().toISOString() })
        .eq("id", item.id);

      onPreferencesUpdated();
    } catch (err) {
      console.error("Failed to save number preference", err);
    }
  };

  // Save all items batch
  const saveAllPrefs = async (itemsList = localList) => {
    setSaving(true);
    try {
      const records = itemsList.map((item, idx) => ({
        phone_number_id: item.id,
        label_override: item.displayName,
        emoji: item.emoji,
        hidden: item.hidden,
        sort_order: idx,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("quo_number_preferences")
        .upsert(records, { onConflict: "phone_number_id" });

      if (error) {
        console.warn("Batch upsert error:", error.message);
      }

      // Also update names in quo_phone_numbers
      for (const item of itemsList) {
        await supabase
          .from("quo_phone_numbers")
          .update({ name: item.displayName, updated_at: new Date().toISOString() })
          .eq("id", item.id);
      }

      toast.success("Number preferences saved successfully!");
      onPreferencesUpdated();
    } catch (err) {
      toast.error(`Error saving preferences: ${(err as { message?: string }).message}`);
    } finally {
      setSaving(false);
    }
  };

  // Quick Action: Hide All
  const handleHideAll = async () => {
    const updated = localList.map((item) => ({ ...item, hidden: true }));
    setLocalList(updated);
    await saveAllPrefs(updated);
  };

  // Quick Action: Show All
  const handleShowAll = async () => {
    const updated = localList.map((item) => ({ ...item, hidden: false }));
    setLocalList(updated);
    await saveAllPrefs(updated);
  };

  const hiddenCount = useMemo(() => localList.filter((i) => i.hidden).length, [localList]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0b1329] border border-slate-800 text-slate-100 p-6 shadow-2xl rounded-2xl sm:rounded-3xl overflow-hidden">
        <DialogHeader className="space-y-1.5 pb-3 border-b border-slate-800/80">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-indigo-400" />
              <span>Quo number display</span>
            </DialogTitle>
            {hiddenCount > 0 && (
              <Badge variant="secondary" className="bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs px-2.5 py-0.5">
                {hiddenCount} Hidden
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-slate-400">
            Rename, add emoji, hide from table, or reorder. Drag a row or use arrows.
          </DialogDescription>
        </DialogHeader>

        {/* Action Controls & Search Bar */}
        <div className="py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number name..."
                className="pl-9 h-9 text-xs bg-slate-900/90 border-slate-800 text-slate-200 placeholder:text-slate-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleShowAll}
                className="h-8 text-xs bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Eye className="h-3.5 w-3.5 mr-1 text-emerald-400" /> Show All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleHideAll}
                className="h-8 text-xs bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <EyeOff className="h-3.5 w-3.5 mr-1 text-rose-400" /> Hide All
              </Button>
            </div>
          </div>
        </div>

        {/* Scrollable Number Display Items List */}
        <ScrollArea className="max-h-[420px] pr-2.5">
          <div className="space-y-2.5 pb-2">
            {filteredList.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No QUO numbers matching filter
              </div>
            ) : (
              filteredList.map((item, index) => {
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${
                      item.hidden
                        ? "bg-slate-950/40 border-slate-900 opacity-60 hover:opacity-100"
                        : "bg-slate-900/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    {/* Drag Grip Handle Icon */}
                    <div className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300">
                      <GripVertical className="h-4 w-4" />
                    </div>

                    {/* Icon Badge Container */}
                    <div className="h-9 w-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 shadow-sm select-none">
                      <RenderEmoji emoji={item.emoji} size="md" />
                    </div>

                    {/* Number Name Input & Chat Count Details */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <Input
                        value={item.displayName}
                        onChange={(e) => handleNameChange(item.id, e.target.value)}
                        onBlur={() => saveSinglePref(item)}
                        className="h-8 text-xs font-semibold bg-slate-950/80 border-slate-800 text-slate-100 focus:border-indigo-500 px-2.5 rounded-lg"
                      />
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 pl-0.5">
                        <span>{item.chatCount} chat{item.chatCount === 1 ? "" : "s"}</span>
                        <span>•</span>
                        <span className="font-mono text-slate-500">{formatUsPhone(item.number)}</span>
                      </div>
                    </div>

                    {/* Hide / Show Toggle Button */}
                    <Button
                      variant={item.hidden ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => handleToggleHide(item.id)}
                      className={`h-8 px-3 text-xs font-medium rounded-lg shrink-0 transition-colors ${
                        item.hidden
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30"
                          : "bg-slate-950/80 border-slate-800 text-slate-200 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {item.hidden ? (
                        <>
                          <Eye className="h-3.5 w-3.5 mr-1.5 text-rose-400" />
                          <span>Hidden</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                          <span>Hide</span>
                        </>
                      )}
                    </Button>

                    {/* Up / Down Reorder Buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move up"
                        onClick={() => handleMove(index, "up")}
                        disabled={index === 0}
                        className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 rounded-lg"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move down"
                        onClick={() => handleMove(index, "down")}
                        disabled={index === filteredList.length - 1}
                        className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 rounded-lg"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span>{localList.length} total numbers configured</span>
          <Button
            size="sm"
            onClick={() => {
              saveAllPrefs();
              onOpenChange(false);
            }}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 text-white h-8 text-xs font-semibold px-4 rounded-xl"
          >
            {saving ? "Saving..." : "Done"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
