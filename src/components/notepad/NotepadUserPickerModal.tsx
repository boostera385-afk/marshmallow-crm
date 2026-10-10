import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotepad } from "@/contexts/NotepadContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, User, Shield, Check, ExternalLink, XCircle } from "lucide-react";

interface WorkspaceUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export default function NotepadUserPickerModal() {
  const { user, role } = useAuth();
  const { isPickerOpen, closePicker, openNotepad, closeNotepad, activeUserIds } = useNotepad();
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = role === "admin";

  useEffect(() => {
    if (!isPickerOpen || !isAdmin) return;

    const fetchWorkspaceUsers = async () => {
      setLoading(true);
      try {
        const [{ data: profiles }, { data: roles }] = await Promise.all([
          supabase.from("profiles_public").select("id, full_name, email") as unknown as PromiseLike<{ data: { id: string; full_name: string | null; email: string | null }[] | null }>,
          supabase.from("user_roles").select("user_id, role"),
        ]);

        const roleMap: Record<string, string> = {};
        if (roles) {
          roles.forEach((r) => {
            roleMap[r.user_id] = r.role;
          });
        }

        if (profiles) {
          const list: WorkspaceUser[] = profiles.map((p) => ({
            id: p.id,
            full_name: p.full_name || p.email || "Unknown User",
            email: p.email || "",
            role: roleMap[p.id] || "user",
          }));

          setUsers(list);
        }
      } catch (err) {
        console.error("Failed to fetch workspace users for notepad picker", err);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkspaceUsers();
  }, [isPickerOpen, isAdmin]);

  if (!isAdmin) return null;

  const filteredUsers = users.filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggleUserNotepad = (targetId: string) => {
    if (activeUserIds.includes(targetId)) {
      closeNotepad(targetId);
    } else {
      openNotepad(targetId);
    }
  };

  return (
    <Dialog open={isPickerOpen} onOpenChange={(open) => !open && closePicker()}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden glass-panel-strong border-border/80 shadow-2xl">
        <DialogHeader className="p-5 pb-3 border-b border-border/40 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle className="text-lg font-semibold tracking-tight">
                Notepad Manager
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Select any user to open their notepad on screen. Multiple notepads can be open simultaneously.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {/* Quick Action: Open My Notepad */}
          {user?.id && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5">
              <div className="flex items-center gap-2.5">
                <Shield className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    My Notepad (Admin)
                    <Badge variant="outline" className="text-[10px] uppercase border-primary/30 text-primary">
                      You
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Your personal notepad scratchpad</div>
                </div>
              </div>
              <Button
                size="sm"
                variant={activeUserIds.includes(user.id) ? "secondary" : "default"}
                onClick={() => handleToggleUserNotepad(user.id)}
                className="h-8 gap-1.5 text-xs font-medium"
              >
                {activeUserIds.includes(user.id) ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    Open on Screen
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Notepad
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user name, email, or role..."
              className="pl-9 h-9 text-xs bg-background/80"
            />
          </div>

          {/* Users List */}
          <ScrollArea className="h-[280px] pr-2">
            {loading ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                Loading team members...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No users found matching "{search}"
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredUsers.map((u) => {
                  const isOpenOnScreen = activeUserIds.includes(u.id);
                  const isMe = u.id === user?.id;

                  return (
                    <div
                      key={u.id}
                      onClick={() => handleToggleUserNotepad(u.id)}
                      className={`group flex items-center justify-between p-2.5 rounded-xl border transition-all duration-150 cursor-pointer ${
                        isOpenOnScreen
                          ? "border-primary/40 bg-primary/5 shadow-sm"
                          : "border-border/50 hover:border-border hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold shrink-0 ${
                          isOpenOnScreen
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground group-hover:bg-accent"
                        }`}>
                          {u.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground truncate">
                              {u.full_name}
                            </span>
                            {isMe && (
                              <span className="text-[10px] font-medium text-primary">(You)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge variant="secondary" className="text-[10px] font-mono capitalize px-1.5 py-0">
                              {u.role.replace("_", " ")}
                            </Badge>
                            {u.email && (
                              <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
                                {u.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant={isOpenOnScreen ? "destructive" : "outline"}
                        className="h-7 text-[11px] gap-1 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleUserNotepad(u.id);
                        }}
                      >
                        {isOpenOnScreen ? (
                          <>
                            <XCircle className="h-3 w-3" />
                            Close
                          </>
                        ) : (
                          <>
                            <ExternalLink className="h-3 w-3" />
                            Open
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
